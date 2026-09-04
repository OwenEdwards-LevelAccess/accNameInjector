# AccName/AccDescription/AccRole Injector
A Tampermonkey userscript that allows you to add better "Live expressions" in the Chrome DevTools Console.

With this userscript injected into a page, you can add live expressions to watch these values:
* `element.accName` - the accessible name (computed according to the core implementation of Accessible Name and Description Computation 1.2: https://w3c.github.io/aria/accname/)
* `element.accDescription` - the accessible description (computed according to the core implementation of Accessible Name and Description Computation 1.2: https://w3c.github.io/aria/accname/)
* `element.accRole` - the _computed_ role of the element (including the implicit role of an HTML element, not just the ARIA `role` attribute)

**NOTE:** These values *may* differ from those displayed in DevTools > Accessibility. Always verify information provided by this script.

## Usage

For example, **add these three "Live expressions" in the DevTools Console and then do keyboard-only testing on the page** and observe how these expressions relate to the element that has visual focus (or doesn't!):

`document.activeElement`

`document.activeElement?.accName`

`document.activeElement?.accRole`

## Installation

Go to **Tampermonkey** (*extension in Chrome*) **>** **Dashboard** (*menu item*) **>** **Utilities** (*tab*), and paste this URL into the **Import from URL** field, and then click **Install**. Then, on the edit script page, click **Install**.

https://raw.githubusercontent.com/OwenEdwards-LevelAccess/accNameInjector/main/accNameInjector.js
