// ==UserScript==
// @name         AccName/AccDescription Injector
// @namespace    http://tampermonkey.net/
// @version      2.0
// @downloadURL    https://raw.githubusercontent.com/OwenEdwards-LevelAccess/accNameInjector/refs/heads/main/accNameInjector.js
// @updateURL    https://raw.githubusercontent.com/OwenEdwards-LevelAccess/accNameInjector/refs/heads/main/accNameInjector.js
// @description  Adds live-updating accName and accDescription properties to every DOM element, based on core implementation of Accessible Name and Description Computation 1.2: https://w3c.github.io/aria/accname/
// @author       Owen Edwards
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // -----------------------------------------------------------------
    // Accessible Name / Description computation
    // (core implementation of Accessible Name and Description Computation 1.2:
    //  https://w3c.github.io/aria/accname/)
    // -----------------------------------------------------------------

    // From GitHub Copilot:
    // There are still boundaries I cannot claim are fully conformant without a complete host-language accessibility mapping database:
    // * The script has conservative implicit HTML role mappings rather than a complete HTML-AAM implementation.
    // * SVG and MathML host-language naming rules are only partially covered.
    // * CSS generated-content spacing depends on the newer AccName 1.2 display-sensitive rules and remains approximate.
    // * Browser accessibility trees may differ from DOM-based computation in areas such as presentational-child conflict resolution and complex aria-owns relationships.

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
        return role.trim().split(/\s+/).find((token) => KNOWN_ROLES.has(token)) || '';
    }

    function idRefsToElements(ids, doc) {
        if (!ids) return [];
        return ids
            .trim()
            .split(/\s+/)
            .map((id) => doc.getElementById(id))
            .filter(Boolean);
    }

    function flatString(value) {
        return String(value || '').replace(/[\t\n\f\r ]+/g, ' ').trim();
    }

    function isHiddenFromName(node) {
        return isHidden(node);
    }

    function getRenderedChildNodes(node) {
        if (node.shadowRoot) return Array.from(node.shadowRoot.childNodes);
        if (node.tagName === 'SLOT' && typeof node.assignedNodes === 'function' && node.assignedNodes().length) {
            return node.assignedNodes({ flatten: true });
        }
        return Array.from(node.childNodes);
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
                search: 'searchbox', submit: 'button', reset: 'button',
                button: 'button', image: 'button' })[type] || 'textbox';
        }
        return '';
    }

    function getRoleForNaming(el) {
        return getRole(el) || getNativeRole(el);
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
            const refs = idRefsToElements(labelledBy, node.ownerDocument);
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
        const refs = idRefsToElements(describedBy, node.ownerDocument);
        if (node.hasAttribute('aria-describedby')) {
            return flatString(refs.map((ref) => computeTextAlternative(ref, {
                visitedNodes: new Set(), inLabelledBy: true, allowHidden: isHiddenFromName(ref)
            })).join(' '));
        }
        const ariaDescription = node.getAttribute('aria-description');
        if (ariaDescription !== null) return flatString(ariaDescription);
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
    }

    function processAllElements(root) {
        if (root instanceof Element) definePropertiesOn(root);
        const elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
        elements.forEach(definePropertiesOn);
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
})();
