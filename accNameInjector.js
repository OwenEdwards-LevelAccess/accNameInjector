// ==UserScript==
// @name         AccName/AccDescription Injector
// @namespace    http://tampermonkey.net/
// @version      1.1
// @updateURL    https://raw.githubusercontent.com/OwenEdwards-LevelAccess/accNameInjector/refs/heads/main/accNameInjector.js
// @description  Adds live-updating accName and accDescription properties to every DOM element, based on the accessible name/description computation algorithm (https://github.com/google/accname)
// @author       Owen Edwards
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // -----------------------------------------------------------------
    // Accessible Name / Description computation
    // (simplified re-implementation of the accname algorithm:
    //  https://github.com/google/accname
    //  implements the core steps of the AccName 1.1 spec:
    //  https://www.w3.org/TR/accname-1.1/)
    // -----------------------------------------------------------------

    const NAME_FROM_CONTENT_ROLES = new Set([
        'button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading',
        'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
        'radio', 'row', 'rowheader', 'switch', 'tab', 'tooltip', 'treeitem'
    ]);

    function isHidden(node) {
        if (!(node instanceof Element)) return false;
        if (node.hasAttribute('aria-hidden') && node.getAttribute('aria-hidden') === 'true') return true;
        if (node.hidden) return true;
        const style = window.getComputedStyle(node);
        if (!style) return false;
        return style.display === 'none' || style.visibility === 'hidden';
    }

    function getRole(el) {
        return el.getAttribute && el.getAttribute('role');
    }

    function idRefsToElements(ids, doc) {
        if (!ids) return [];
        return ids
            .trim()
            .split(/\s+/)
            .map((id) => doc.getElementById(id))
            .filter(Boolean);
    }

    function computeTextAlternative(node, context) {
        context = context || { visitedNodes: new Set(), inLabelledBy: false, inLabel: false };

        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || '';
        }

        if (!(node instanceof Element)) return '';

        if (context.visitedNodes.has(node)) return '';
        context.visitedNodes.add(node);

        // Step 2A: aria-labelledby (not applicable when already resolving a labelledby chain)
        if (!context.inLabelledBy) {
            const labelledBy = node.getAttribute && node.getAttribute('aria-labelledby');
            const refs = idRefsToElements(labelledBy, node.ownerDocument);
            if (refs.length) {
                const parts = refs.map((ref) =>
                    computeTextAlternative(ref, { ...context, inLabelledBy: true })
                );
                const joined = parts.join(' ').trim();
                if (joined) return joined;
            }
        }

        // Step 2B: aria-label
        const ariaLabel = node.getAttribute && node.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

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
                    const text = computeTextAlternative(label, { ...context, inLabel: true });
                    if (text && text.trim()) return text.trim();
                }
            }
            // wrapping <label>
            const parentLabel = node.closest && node.closest('label');
            if (parentLabel) {
                const text = computeTextAlternative(parentLabel, { ...context, inLabel: true });
                if (text && text.trim()) return text.trim();
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

        // Step 2D/2E: name from content, for elements whose role supports it
        const role = getRole(node);
        const nameFromContent =
            (role && NAME_FROM_CONTENT_ROLES.has(role)) ||
            ['button', 'a', 'summary', 'caption', 'legend', 'label'].includes(tag) ||
            context.inLabelledBy ||
            context.inLabel;

        if (nameFromContent && !isHidden(node)) {
            let content = '';
            node.childNodes.forEach((child) => {
                if (child.nodeType === Node.TEXT_NODE) {
                    content += child.textContent;
                } else if (child.nodeType === Node.ELEMENT_NODE && !isHidden(child)) {
                    content += ' ' + computeTextAlternative(child, context);
                }
            });
            content = content.replace(/\s+/g, ' ').trim();
            if (content) return content;
        }

        // Step 2I: title attribute as fallback
        const title = node.getAttribute && node.getAttribute('title');
        if (title && title.trim()) return title.trim();

        return '';
    }

    function computeDescription(node) {
        if (!(node instanceof Element)) return '';
        const describedBy = node.getAttribute('aria-describedby');
        const refs = idRefsToElements(describedBy, node.ownerDocument);
        if (refs.length) {
            const parts = refs.map((ref) =>
                computeTextAlternative(ref, { visitedNodes: new Set(), inLabelledBy: true })
            );
            const joined = parts.join(' ').trim();
            if (joined) return joined;
        }
        const title = node.getAttribute('title');
        if (title && title.trim()) return title.trim();
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
                'alt',
                'title',
                'value',
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
