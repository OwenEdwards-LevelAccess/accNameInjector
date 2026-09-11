// ==UserScript==
// @name         AccName/AccDescription/AccRole/AccState/AccAttributes Injector
// @namespace    http://tampermonkey.net/
// @version      6.0.0
// @downloadURL  https://raw.githubusercontent.com/OwenEdwards-LevelAccess/accNameInjector/refs/heads/main/accNameInjector.js
// @updateURL    https://raw.githubusercontent.com/OwenEdwards-LevelAccess/accNameInjector/refs/heads/main/accNameInjector.js
// @description  Adds live-updating accName and accDescription properties to every DOM element, based on core implementation of Accessible Name and Description Computation 1.2: https://w3c.github.io/aria/accname/. Also adds accRole, accState, and accAttributes properties, and document.deepActiveElement for pages with iframes.
// @author       Owen Edwards
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    console.info(
        '%cAccName/AccDescription/AccRole/AccState/AccAttributes Injector userscript is running.\n' +
        '%cAdd live expressions to watch values such as:\n' +
        '%cdocument.deepActiveElement?.accName\n' +
        'document.deepActiveElement?.accDescription\n' +
        'document.deepActiveElement?.accRole %c(the computed role of the element).%c\n' +
        'document.deepActiveElement?.accState\n' +
        'document.deepActiveElement?.accAttributes\n' +
        '\n%cThese values *may* differ from those displayed in DevTools > Accessibility; ' +
        'always verify information provided by this script.',
        'font-size: 1.5em; color: white; background-color: black;',
        'font-size: 1.2em;',
        'font-family: system-ui; font-size: 1.2em;',
        'font-style: italic; font-size: 1.2em;',
        'font-family: system-ui; font-size: 1.2em;',
        'color: red; font-size: 1.2em',
    );

    // -----------------------------------------------------------------
    // Accessible Name / Description computation
    // (core implementation of Accessible Name and Description Computation 1.2:
    //  https://w3c.github.io/aria/accname/)
    // -----------------------------------------------------------------

    // From GitHub Copilot, for accName and accDescription:
    // There are still boundaries I cannot claim are fully conformant without a complete host-language accessibility mapping database:
    // * The script has conservative implicit HTML role mappings rather than a complete HTML-AAM implementation.
    // * SVG and MathML host-language naming rules are only partially covered.
    // * CSS generated-content spacing depends on the newer AccName 1.2 display-sensitive rules and remains approximate.
    // * Browser accessibility trees may differ from DOM-based computation in areas such as presentational-child conflict resolution and complex aria-owns relationships.

    // From GitHub Copilot, for accRole:
    // There is one important boundary: this is still a DOM-side approximation of Chromium’s Blink AX tree.
    // Chromium has additional context-sensitive behavior for the full HTML-AAM, SVG/MathML, DPUB-ARIA roles,
    // malformed structures, aria-owns, presentational-child conflict resolution, and platform-specific AX roles.
    // I am not certain that every internal Chromium role string would be identical without querying the browser’s Accessibility domain directly.

    const NAME_FROM_CONTENT_ROLES = new Set([
        'button', 'cell', 'checkbox', 'columnheader', 'comment', 'gridcell',
        'heading', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
        'option', 'radio', 'row', 'rowheader', 'switch', 'tab', 'treeitem'
    ]);

    const NAME_PROHIBITED_ROLES = new Set([
        'caption', 'code', 'definition', 'deletion', 'emphasis', 'generic',
        'insertion', 'mark', 'none', 'paragraph', 'strong', 'subscript',
        'suggestion', 'superscript', 'term', 'time', 'tooltip'
    ]);

    const KNOWN_ROLES = new Set([
        'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote',
        'button', 'cell', 'checkbox', 'code', 'columnheader', 'combobox',
        'comment', 'complementary', 'contentinfo', 'definition', 'deletion',
        'dialog', 'directory', 'document', 'emphasis', 'feed', 'figure', 'form',
        'generic', 'grid', 'gridcell', 'group', 'heading', 'image', 'img',
        'insertion', 'link', 'list', 'listbox', 'listitem', 'log', 'main',
        'mark', 'marquee', 'math', 'menu', 'menubar', 'menuitem',
        'menuitemcheckbox', 'menuitemradio', 'meter', 'navigation', 'none',
        'note', 'option', 'paragraph', 'presentation', 'progressbar', 'radio',
        'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar',
        'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status',
        'strong', 'subscript', 'suggestion', 'superscript', 'switch', 'tab',
        'table', 'tablist', 'tabpanel', 'term', 'textbox', 'time', 'timer',
        'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem'
    ]);

    function isHidden(node) {
        if (!(node instanceof Element)) return false;
        if (node.hasAttribute('aria-hidden') && node.getAttribute('aria-hidden') === 'true') return true;
        if (node.hidden) return true;
        const style = window.getComputedStyle(node);
        if (!style) return false;
        return style.display === 'none' || style.visibility === 'hidden' ||
            style.visibility === 'collapse' || style.contentVisibility === 'hidden';
    }

    function getRole(el) {
        if (!el.getAttribute) return '';
        const role = el.getAttribute('role');
        if (!role) return '';
        return role.trim().split(/\s+/).map((token) => token.toLowerCase())
            .find((token) => KNOWN_ROLES.has(token)) || '';
    }

    function idRefsToElements(ids, referenceNode) {
        if (!ids) return [];
        return ids
            .trim()
            .split(/\s+/)
            .map((id) => findElementById(id, referenceNode))
            .filter(Boolean);
    }

    function findElementById(id, referenceNode) {
        const root = referenceNode && typeof referenceNode.getRootNode === 'function'
            ? referenceNode.getRootNode()
            : document;
        const localMatch = root.getElementById ? root.getElementById(id) :
            root.querySelector?.(`[id="${CSS.escape(id)}"]`);
        if (localMatch) return localMatch;

        const documentMatch = document.getElementById(id);
        if (documentMatch) return documentMatch;

        const searchShadowRoot = (shadowRoot) => {
            const match = shadowRoot.querySelector(`[id="${CSS.escape(id)}"]`);
            if (match) return match;
            for (const element of shadowRoot.querySelectorAll('*')) {
                if (!element.shadowRoot) continue;
                const nestedMatch = searchShadowRoot(element.shadowRoot);
                if (nestedMatch) return nestedMatch;
            }
            return null;
        };

        for (const element of document.querySelectorAll('*')) {
            if (!element.shadowRoot) continue;
            const match = searchShadowRoot(element.shadowRoot);
            if (match) return match;
        }
        return null;
    }

    function flatString(value) {
        return String(value || '').replace(/[\t\n\f\r ]+/g, ' ').trim();
    }

    function isHiddenFromName(node) {
        return isHidden(node);
    }

    function getRenderedChildNodes(node) {
        if (node.tagName === 'SLOT' && typeof node.assignedNodes === 'function' && node.assignedNodes().length) {
            return node.assignedNodes({ flatten: true });
        }
        if (node.shadowRoot) return Array.from(node.shadowRoot.childNodes);
        return Array.from(node.childNodes);
    }

    function getShadowSemanticElement(el) {
        if (!el.shadowRoot) return null;
        const candidates = [el.shadowRoot, ...el.shadowRoot.querySelectorAll('*')];
        return candidates.find((candidate) => {
            if (!(candidate instanceof Element) || candidate === el) return false;
            return getRole(candidate) || getNativeRole(candidate) ||
                ['button', 'input', 'select', 'textarea', 'option'].includes(candidate.tagName.toLowerCase());
        }) || null;
    }

    function getPseudoContent(node, pseudo) {
        try {
            const content = window.getComputedStyle(node, pseudo).content;
            if (!content || content === 'none' || content === 'normal') return '';
            return content.replace(/^(['"])(.*)\1$/, '$2');
        } catch (e) {
            return '';
        }
    }

    function getNativeRole(el) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'a' && el.hasAttribute('href')) return 'link';
        if (tag === 'button') return 'button';
        if (tag === 'img') return 'img';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'select') return el.multiple ? 'listbox' : 'combobox';
        if (tag === 'input') {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            return ({ checkbox: 'checkbox', radio: 'radio', range: 'slider',
                number: 'spinbutton', search: 'searchbox', submit: 'button', reset: 'button',
                button: 'button', image: 'button' })[type] || 'textbox';
        }
        return '';
    }

    function getRoleForNaming(el) {
        if (!(el instanceof Element)) return '';
        const shadowSemanticElement = getShadowSemanticElement(el);
        return getRole(el) || getNativeRole(el) ||
            (shadowSemanticElement ? getRoleForNaming(shadowSemanticElement) : '');
    }

    function isFocusable(el) {
        if (el.hasAttribute('disabled')) return false;
        if (el.hasAttribute('tabindex')) return el.tabIndex >= 0;
        const tag = el.tagName.toLowerCase();
        return tag === 'button' || tag === 'select' || tag === 'textarea' ||
            (tag === 'input' && (el.getAttribute('type') || 'text') !== 'hidden') ||
            (tag === 'a' && el.hasAttribute('href'));
    }

    function hasGlobalAriaAttribute(el) {
        return Array.from(el.attributes).some((attribute) =>
            attribute.name.startsWith('aria-') && [
                'aria-atomic', 'aria-busy', 'aria-controls', 'aria-current',
                'aria-describedby', 'aria-description', 'aria-details',
                'aria-disabled', 'aria-errormessage', 'aria-flowto',
                'aria-grabbed', 'aria-haspopup', 'aria-hidden',
                'aria-invalid', 'aria-keyshortcuts', 'aria-live', 'aria-owns',
                'aria-relevant', 'aria-roledescription', 'aria-label',
                'aria-labelledby'
            ].includes(attribute.name));
    }

    function getImplicitRole(el) {
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();

        if (tag === 'html') return 'document';
        if (tag === 'a' && el.hasAttribute('href')) return 'link';
        if (tag === 'area' && el.hasAttribute('href')) return 'link';
        if (tag === 'button') return 'button';
        if (tag === 'summary') return 'button';
        if (tag === 'img') return 'img';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'select') return el.multiple ? 'listbox' : 'combobox';
        if (tag === 'option') return 'option';
        if (tag === 'optgroup') return 'group';
        if (tag === 'input') {
            return ({
                checkbox: 'checkbox',
                radio: 'radio',
                range: 'slider',
                number: 'spinbutton',
                search: 'searchbox',
                submit: 'button',
                reset: 'button',
                button: 'button',
                image: 'button',
                file: 'button'
            })[type] || (type === 'hidden' ? 'none' : 'textbox');
        }

        if (/^h[1-6]$/.test(tag)) return 'heading';
        if (tag === 'table') return 'table';
        if (tag === 'caption') return 'caption';
        if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') return 'rowgroup';
        if (tag === 'tr') return 'row';
        if (tag === 'th') return el.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader';
        if (tag === 'td') return 'cell';
        if (tag === 'ul' || tag === 'ol') return 'list';
        if (tag === 'li') return 'listitem';
        if (tag === 'dt') return 'term';
        if (tag === 'dd') return 'definition';
        if (tag === 'header') return 'banner';
        if (tag === 'footer') return 'contentinfo';
        if (tag === 'nav') return 'navigation';
        if (tag === 'main') return 'main';
        if (tag === 'aside') return 'complementary';
        if (tag === 'form') return getAccessibleName(el) ? 'form' : 'generic';
        if (tag === 'section') return getAccessibleName(el) ? 'region' : 'generic';
        if (tag === 'article') return 'article';
        if (tag === 'blockquote') return 'blockquote';
        if (tag === 'figure') return 'figure';
        if (tag === 'figcaption') return 'caption';
        if (tag === 'hr') return 'separator';
        if (tag === 'pre' || tag === 'code') return 'code';
        if (tag === 'em') return 'emphasis';
        if (tag === 'strong') return 'strong';
        if (tag === 'del' || tag === 's') return 'deletion';
        if (tag === 'ins') return 'insertion';
        if (tag === 'mark') return 'mark';
        if (tag === 'time') return 'time';
        if (tag === 'sub') return 'subscript';
        if (tag === 'sup') return 'superscript';
        if (tag === 'p') return 'paragraph';
        if (tag === 'output') return 'status';
        if (tag === 'video') return 'video';
        if (tag === 'audio') return 'audio';
        if (tag === 'iframe') return 'iframe';
        if (tag === 'canvas') return 'canvas';
        if (tag === 'svg') return 'img';
        return 'generic';
    }

    function getAccessibleRole(el) {
        const explicitRole = getRole(el);
        const nativeRole = getImplicitRole(el);
        const shadowSemanticElement = getShadowSemanticElement(el);
        const implicitRole = nativeRole === 'generic' && shadowSemanticElement
            ? getRoleForNaming(shadowSemanticElement)
            : nativeRole;
        let role;

        if (explicitRole && !['none', 'presentation'].includes(explicitRole)) {
            role = explicitRole;
        } else if (explicitRole && ['none', 'presentation'].includes(explicitRole)) {
            role = isFocusable(el) || hasGlobalAriaAttribute(el) ? implicitRole : 'none';
        } else {
            role = implicitRole;
        }

        const roleDescription = el.getAttribute('aria-roledescription');
        return roleDescription !== null ? `${role} (roledescription: ${roleDescription})` : role;
    }

    function getControlValue(node, role) {
        if (role === 'textbox' || role === 'searchbox') {
            return 'value' in node ? node.value : node.isContentEditable ? node.textContent : '';
        }
        if (role === 'combobox' || role === 'listbox') {
            if (node instanceof HTMLSelectElement) {
                return Array.from(node.selectedOptions).map((option) => flatString(option.textContent)).join(' ');
            }
            const selected = node.querySelector('[aria-selected="true"], [aria-checked="true"]');
            return selected ? computeTextAlternative(selected, { visitedNodes: new Set(), allowHidden: false }) : '';
        }
        if (['meter', 'progressbar', 'scrollbar', 'separator', 'slider', 'spinbutton'].includes(role)) {
            return node.getAttribute('aria-valuetext') ?? node.getAttribute('aria-valuenow') ??
                node.getAttribute('value') ?? '';
        }
        return '';
    }

    function computeTextAlternative(node, context) {
        context = context || { visitedNodes: new Set(), inLabelledBy: false, inLabel: false, allowHidden: false };

        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || '';
        }

        if (!(node instanceof Element)) return '';

        if (context.visitedNodes.has(node)) return '';
        context.visitedNodes.add(node);

        if (!context.allowHidden && isHiddenFromName(node)) return '';

        const role = getRoleForNaming(node);
        if (!context.inLabelledBy && !context.inLabel && NAME_PROHIBITED_ROLES.has(role)) return '';

        // Step 2A: aria-labelledby (not applicable when already resolving a labelledby chain)
        if (!context.inLabelledBy) {
            const labelledBy = node.getAttribute && node.getAttribute('aria-labelledby');
            const refs = idRefsToElements(labelledBy, node);
            if (refs.length) {
                const parts = refs.map((ref) =>
                    computeTextAlternative(ref, { ...context, inLabelledBy: true, allowHidden: isHiddenFromName(ref) })
                );
                return flatString(parts.join(' '));
            }
        }

        // Step 2B: aria-label
        const ariaLabel = node.getAttribute && node.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.trim() && !NAME_PROHIBITED_ROLES.has(role)) return flatString(ariaLabel);

        // Step 2C: host language labelling (label element, alt, title, etc.)
        const tag = node.tagName ? node.tagName.toLowerCase() : '';

        if (tag === 'img' || tag === 'area') {
            const alt = node.getAttribute('alt');
            if (alt && alt.trim()) return alt.trim();
        }

        if (node.hasAttribute('label') && node.getAttribute('label').trim()) {
            return flatString(node.getAttribute('label'));
        }

        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            // associated <label for="">
            if (node.id) {
                const label = node.ownerDocument.querySelector(`label[for="${CSS.escape(node.id)}"]`);
                if (label) {
                    const text = computeTextAlternative(label, { ...context, inLabel: true, allowHidden: context.allowHidden });
                    if (text) return text;
                }
            }
            // wrapping <label>
            const parentLabel = node.closest && node.closest('label');
            if (parentLabel) {
                const text = computeTextAlternative(parentLabel, { ...context, inLabel: true, allowHidden: context.allowHidden });
                if (text) return text;
            }
            if (tag === 'input') {
                const type = (node.getAttribute('type') || '').toLowerCase();
                if (type === 'submit' || type === 'button') {
                    const value = node.getAttribute('value');
                    if (value && value.trim()) return value.trim();
                    if (type === 'submit') return 'Submit';
                }
                if (type === 'image') {
                    const alt = node.getAttribute('alt');
                    if (alt && alt.trim()) return alt.trim();
                }
            }
        }

        if (tag === 'fieldset') {
            const legend = node.querySelector(':scope > legend');
            if (legend) {
                const text = computeTextAlternative(legend, context);
                if (text && text.trim()) return text.trim();
            }
        }

        if (tag === 'table') {
            const caption = node.querySelector(':scope > caption');
            if (caption) {
                const text = computeTextAlternative(caption, context);
                if (text && text.trim()) return text.trim();
            }
        }

        const nameFromContent = NAME_FROM_CONTENT_ROLES.has(role) ||
            ['button', 'a', 'summary', 'legend', 'label'].includes(tag) ||
            context.inLabelledBy || context.inLabel;

        if (nameFromContent || context.isDescendant) {
            let content = getPseudoContent(node, '::before');
            const childParts = [];
            getRenderedChildNodes(node).forEach((child) => {
                if (child.nodeType === Node.TEXT_NODE) {
                    childParts.push(child.textContent || '');
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    const childRole = getRoleForNaming(child);
                    const embeddedValue = context.inLabel && getControlValue(child, childRole);
                    childParts.push(embeddedValue || computeTextAlternative(child, {
                        ...context,
                        isDescendant: true,
                        allowHidden: context.allowHidden,
                        inLabel: context.inLabel || context.inLabelledBy
                    }));
                }
            });
            content += childParts.join(' ');
            content += getPseudoContent(node, '::after');
            content = flatString(content);
            if (content) return content;
        }

        // Step 2I: title attribute as fallback
        const title = node.getAttribute && node.getAttribute('title');
        if (title && title.trim() && !NAME_PROHIBITED_ROLES.has(role)) return flatString(title);

        return '';
    }

    function computeDescription(node) {
        if (!(node instanceof Element)) return '';
        const describedBy = node.getAttribute('aria-describedby');
        const refs = idRefsToElements(describedBy, node);
        if (node.hasAttribute('aria-describedby')) {
            return flatString(refs.map((ref) => computeTextAlternative(ref, {
                visitedNodes: new Set(), inLabelledBy: true, allowHidden: isHiddenFromName(ref)
            })).join(' '));
        }
        const ariaDescription = node.getAttribute('aria-description');
        if (ariaDescription !== null) return flatString(ariaDescription);
        const componentDescription = node.getAttribute('description');
        if (componentDescription && componentDescription.trim()) return flatString(componentDescription);
        const title = node.getAttribute('title');
        if (title && title.trim() && getAccessibleName(node) !== flatString(title)) return flatString(title);
        return '';
    }

    function getAccessibleName(el) {
        try {
            return computeTextAlternative(el, { visitedNodes: new Set() }).trim();
        } catch (e) {
            return '';
        }
    }

    function getAccessibleDescription(el) {
        try {
            return computeDescription(el).trim();
        } catch (e) {
            return '';
        }
    }

    function getSelectedOptionText(option) {
        return flatString(option.label || option.textContent || option.value || '');
    }

    function getRangeState(el, role) {
        const valueNow = role === 'slider' && el.hasAttribute('aria-valuenow')
            ? el.getAttribute('aria-valuenow')
            : 'value' in el
                ? el.value
                : el.getAttribute('aria-valuenow');
        if (valueNow === null || valueNow === undefined || valueNow === '') return '';

        const valueText = el.getAttribute('aria-valuetext');
        return valueText ? `${valueNow} (${valueText})` : String(valueNow);
    }

    function getCheckedState(value) {
        return ({
            true: 'checked',
            false: 'not checked',
            mixed: 'mixed checked'
        })[value] || value;
    }

    function getSwitchState(value) {
        return ({
            true: 'on',
            false: 'off'
        })[value] || value;
    }

    function getAccessibleState(el) {
        try {
            const tag = el.tagName.toLowerCase();
            const role = getRoleForNaming(el);
            const states = [];

            if (tag === 'input') {
                const type = (el.getAttribute('type') || 'text').toLowerCase();
                      if (type === 'checkbox') {
                          states.push(role === 'switch'
                                ? (el.checked ? 'on' : 'off')
                                : (el.checked ? 'checked' : 'not checked'));
                } else if (type === 'radio') {
                    states.push(el.checked ? 'selected' : 'not selected');
                } else if (['email', 'password', 'search', 'tel', 'text', 'url'].includes(type)) {
                    states.push(el.value);
                }
            } else if (tag === 'textarea') {
                states.push(el.value);
            } else if (tag === 'select') {
                states.push(Array.from(el.selectedOptions).map(getSelectedOptionText).join(', '));
            } else if (tag === 'option') {
                states.push(el.selected ? 'selected' : 'not selected');
            } else if (el.isContentEditable) {
                states.push(el.textContent || '');
            } else if (['combobox', 'listbox'].includes(role)) {
                const selectedOptions = el.querySelectorAll('[aria-selected="true"], [aria-checked="true"]');
                states.push(Array.from(selectedOptions).map((option) =>
                    flatString(computeTextAlternative(option, { visitedNodes: new Set(), allowHidden: false }))
                ).join(', '));
            }

            if (['checkbox', 'menuitemcheckbox', 'menuitemradio', 'radio', 'switch'].includes(role) &&
                el.hasAttribute('aria-checked') && !(role === 'switch' &&
                    tag === 'input' && (el.getAttribute('type') || 'text').toLowerCase() === 'checkbox')) {
                const checkedState = el.getAttribute('aria-checked');
                states.push(role === 'switch' ? getSwitchState(checkedState) : getCheckedState(checkedState));
            }

            if (role === 'button' && el.hasAttribute('aria-pressed')) {
                const pressed = el.getAttribute('aria-pressed');
                states.push(pressed === 'true' ? 'pressed' : pressed === 'false' ? 'not pressed' : pressed);
            }

            if (['option', 'tab', 'treeitem', 'gridcell', 'row'].includes(role) &&
                el.hasAttribute('aria-selected')) {
                states.push(el.getAttribute('aria-selected') === 'true' ? 'selected' : 'not selected');
            }

            if (['meter', 'progressbar', 'scrollbar', 'separator', 'slider', 'spinbutton'].includes(role)) {
                states.push(getRangeState(el, role));
            }

            if (['combobox', 'disclosure', 'menu', 'tree', 'treeitem', 'button'].includes(role) &&
                el.hasAttribute('aria-expanded')) {
                states.push(el.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed');
            }

            if (el.hasAttribute('aria-sort')) {
                const sort = el.getAttribute('aria-sort').toLowerCase();
                if (sort === 'ascending' || sort === 'descending') {
                    states.push(`Sorted ${sort}`);
                }
            }

            if (el.getAttribute('aria-invalid') === 'true') states.push('invalid');
            if (el.getAttribute('aria-busy') === 'true') states.push('busy');

            const shadowSemanticElement = getShadowSemanticElement(el);
            if (shadowSemanticElement && !states.length) {
                const shadowState = getAccessibleState(shadowSemanticElement);
                if (shadowState) states.push(shadowState);
            }

            return states.filter((state) => state !== '').join(', ');
        } catch (e) {
            return '';
        }
    }


    const INTERESTING_HTML_ATTRIBUTES = new Set([
        'accesskey', 'autocapitalize', 'autofocus', 'contenteditable',
        'dir', 'dirname', 'draggable', 'enterkeyhint', 'exportparts', 'hidden',
        'inert', 'is', 'lang', 'nonce', 'part', 'popover', 'slot', 'spellcheck',
        'translate', 'virtualkeyboardpolicy', 'writingsuggestions',
        'placeholder', 'readonly', 'disabled', 'size', 'multiple', 'min', 'max', 
        'type', 'href',
        // NOT: 'id', 'class', 'style', 'name', 'value', 'title', 'alt', 'tabindex', 'role'
    ]);

    const INTERESTING_ARIA_ATTRIBUTES = new Set([
        'aria-haspopup', 'aria-valuemin', 'aria-valuemax', 'aria-placeholder', 
        'aria-readonly', 'aria-disabled', 'aria-size', 'aria-multiple', 'aria-min', 
        'aria-max', 'aria-setsize', 'aria-posinset', 'aria-autocomplete', 'aria-modal',
        'aria-orientation', 'aria-required', 'aria-sort',
        // NOT: 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-description',
        // 'aria-controls', 'aria-owns', 'aria-details', 'aria-errormessage', 'aria-activedescendant',
        // 'aria-checked', 'aria-expanded', 'aria-pressed', 'aria-selected', 'aria-valuenow', 'aria-valuetext', 'aria-invalid'
    ]);

    function getAccessibleAttributes(el) {
        try {
            // If we wanted a list of attributes to *exclude*:
            // const excludedAttributes = new Set([
            //     'class', 'style', 'id', 'name', 'value', 'alt', 'title', 'target', 
            //     'tabindex', 'role',
            //     'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-description',
            //     'aria-controls', 'aria-owns', 'aria-details', 'aria-errormessage',
            //     'aria-activedescendant',
            //     'aria-checked', 'aria-expanded', 'aria-pressed', 'aria-selected',
            //     'aria-valuenow', 'aria-valuetext',
            // ]);
            // const attributes = Object.fromEntries(Array.from(el.attributes)
            //     .filter((attribute) =>
            //         !excludedAttributes.has(attribute.name) && !attribute.name.startsWith('data-'))
            //     .map((attribute) => [attribute.name, attribute.value]));

                const omitInputType = el.tagName.toLowerCase() === 'input' &&
                    ['checkbox', 'radio', 'range', 'number', 'button'].includes(
                        (el.getAttribute('type') || 'text').toLowerCase());
                const attributes = Object.fromEntries(Array.from(el.attributes)
                    .filter((attribute) =>
                        attribute.name !== 'type' || !omitInputType)
                    .filter((attribute) =>
                        attribute.name !== 'aria-sort' ||
                        !['ascending', 'descending'].includes(attribute.value.toLowerCase()))
                    .filter((attribute) =>
                        INTERESTING_HTML_ATTRIBUTES.has(attribute.name) || INTERESTING_ARIA_ATTRIBUTES.has(attribute.name))
                    .map((attribute) => [attribute.name, attribute.value]));

                const shadowSemanticElement = getShadowSemanticElement(el);
                if (shadowSemanticElement) {
                    Object.assign(attributes, getAccessibleAttributes(shadowSemanticElement));
                }

            // Check if any ancestor has aria-hidden="true" and propagate it to the attributes.
            let parent = el;
            while (parent) {
                if (parent.getAttribute('aria-hidden') === 'true') {
                    attributes['aria-hidden'] = 'true';
                    break;
                }
                parent = parent.parentElement;
            }

            return attributes;

        } catch (e) {
            return {};
        }
    }

    // -----------------------------------------------------------------
    // Property injection: define live-computed, non-enumerable getters
    // -----------------------------------------------------------------

    function definePropertiesOn(el) {
        if (!(el instanceof Element)) return;
        if (el.__accNameDefined) return;
        el.__accNameDefined = true;

        Object.defineProperty(el, 'accName', {
            configurable: true,
            enumerable: false,
            get() {
                return getAccessibleName(this);
            }
        });

        Object.defineProperty(el, 'accDescription', {
            configurable: true,
            enumerable: false,
            get() {
                return getAccessibleDescription(this);
            }
        });

        Object.defineProperty(el, 'accRole', {
            configurable: true,
            enumerable: false,
            get() {
                try {
                    return getAccessibleRole(this);
                } catch (e) {
                    return '';
                }
            }
        });

        Object.defineProperty(el, 'accState', {
            configurable: true,
            enumerable: false,
            get() {
                return getAccessibleState(this);
            }
        });

        Object.defineProperty(el, 'accAttributes', {
            configurable: true,
            enumerable: false,
            get() {
                return getAccessibleAttributes(this);
            }
        });
    }

    function processAllElements(root) {
        if (root instanceof Element) definePropertiesOn(root);
        const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
        elements.forEach(definePropertiesOn);
        elements.forEach((element) => {
            if (element.shadowRoot) processAllElements(element.shadowRoot);
        });
        if (root instanceof Element && root.shadowRoot) processAllElements(root.shadowRoot);
    }

    // Since accName/accDescription are computed live via getters,
    // "updating" them just means ensuring new nodes get the getters defined.
    // The MutationObserver's job is mainly to catch newly added nodes;
    // attribute changes are picked up automatically since the getters
    // recompute their value on every access.

    function init() {
        processAllElements(document);

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            processAllElements(node);
                        }
                    });
                } else if (mutation.type === 'attributes') {
                    // Ensure the target element has the getters defined
                    // (e.g. if it was created before the observer attached).
                    // No further action needed: reads of accName/accDescription
                    // recompute live, so they reflect the change automatically.
                    if (mutation.target.nodeType === Node.ELEMENT_NODE) {
                        definePropertiesOn(mutation.target);
                    }
                }
            }
        });

        observer.observe(document.documentElement || document, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
                'aria-label',
                'aria-labelledby',
                'aria-describedby',
                'aria-description',
                'alt',
                'title',
                'value',
                'aria-valuetext',
                'aria-valuenow',
                'role',
                'for',
                'id',
                'aria-hidden',
                'hidden'
            ]
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Function to handle retrieving the currently focused element, even if it's inside nested iframes.
    // USAGE:
    // `getDeepActiveElement()?.accName`
    // `getDeepActiveElement()?.accRole`
    function getDeepActiveElement() {
    let activeElement = document.activeElement;

    // Loop as long as the current active element is an iframe
    while (activeElement && activeElement.tagName === 'IFRAME') {
        try {
        // Access the inner document's active element
        const iframeDoc = activeElement.contentWindow.document;
        activeElement = iframeDoc.activeElement;
        } catch (e) {
        // Security Error: The iframe is cross-origin
        // console.warn("Cannot access cross-origin iframe:", activeElement);
        break; 
        }
    }

    return activeElement;
    }

    // window.getDeepActiveElement = getDeepActiveElement;

    Object.defineProperty(document, 'deepActiveElement', {
        configurable: true,
        get() {
            return getDeepActiveElement();
        }
    });
})();

