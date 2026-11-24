# Private Form Assistant

A small Chrome MV3 extension that fills application forms only after the user asks it to. Your profile stays in browser-local extension storage, and you can review every field before submitting a form.

## Features

- Turkish and English field matching for common profile details.
- React and Angular friendly value updates with focus, input, change, and blur events.
- Visibility and honeypot filtering to avoid hidden or clipped fields.
- Custom dropdown support, including pointer-driven option menus.
- `contenteditable` fields, radio controls with SVG or CSS-generated labels, and open or test-exposed Shadow DOM traversal.
- Multi-step forms can be filled one step at a time by clicking **Formu Doldur** again.
- Optional learning prompts are off by default and can be managed in Options.

## Privacy and security design

The extension has no host permissions, injected content-script declarations, background worker, telemetry, analytics, or remote service. It has only the `activeTab`, `scripting`, and `storage` permissions. The page receives no extension code until you click **Formu Doldur** in the extension popup. The script runs once for that request and does not watch the page or fill later fields in the background.

Closed Shadow DOM is intentionally not intercepted in normal browsing. Doing so would require hooking page code before it runs, which would create a passive footprint. The test suite includes a test-only bridge to verify traversal against a closed-root fixture without shipping or injecting that bridge on websites.

The extension refuses fields that appear to request government identifiers, passwords, or financial information. Review every filled field before submitting an application.

## Install in Chrome, Edge, Brave, or Opera

1. Download or clone this repository.
2. Open the browser's extensions page.
3. Enable developer mode.
4. Choose **Load unpacked** and select this repository folder.
5. Open the extension's Options page and save the profile fields you want to use.

## Use

1. Open an application form and select the extension button.
2. Click **Formu Doldur** to fill the fields available on the current page or step.
3. Review the values. For a multi-step form, advance the form and click **Formu Doldur** again.
4. Submit the application yourself after checking all information.

The optional learning prompt is controlled by the opt-in setting on the Options page. Learned values can be reviewed and deleted there. **Tüm Verileri Temizle** removes all locally stored profile and preference data.

## Automated QA

Install the development dependency and run the fixture suite:

```sh
npm install
npm test
```

The runner serves `test/` from an ephemeral localhost port, launches headed Chromium with this extension loaded, verifies the fixtures remain untouched before an explicit fill action, and discovers every HTML fixture in `test/` automatically. A headed Chrome or Edge installation is required. Set `CHROME_PATH` or `EDGE_PATH` if the browser executable is not in a standard location.

## Legal

This project is provided under the MIT License. It is an autofill aid, not an application-submission service. You are responsible for checking the accuracy and appropriateness of information before submitting it.
