/**
 * Minimal en-US locale bundle for the direct-mounted `<CasualSheets>`.
 *
 * Drive mounts the MINIMAL editor (`lazyPlugins={false}`): render + formula
 * engines, UI, docs/docs-ui, sheets, sheets-ui, sheets-formula-ui, numfmt
 * (+ ui). Univer's `LocaleService` throws `Locale not initialized` and the
 * workbench canvas never paints if the `locales` map is empty — so the host
 * MUST seed the string bundle for exactly those plugins.
 *
 * Mirrors the sheet SDK's `embed-runtime/locale.ts`: the iframe path bundles
 * this internally; the React direct-mount path has us (the host) pass it via
 * the `locales` prop. Kept narrow to the minimal plugin set Drive installs.
 */

import { LocaleType, Tools } from "@univerjs/core";

import UniverSheetsEnUS from "@univerjs/sheets/locale/en-US";
import UniverSheetsUIEnUS from "@univerjs/sheets-ui/locale/en-US";
import UniverSheetsFormulaUIEnUS from "@univerjs/sheets-formula-ui/locale/en-US";
import UniverSheetsNumfmtUIEnUS from "@univerjs/sheets-numfmt-ui/locale/en-US";
import UniverDocsUIEnUS from "@univerjs/docs-ui/locale/en-US";
import UniverUIEnUS from "@univerjs/ui/locale/en-US";

const enUS = Tools.deepMerge(
  {},
  UniverUIEnUS,
  UniverDocsUIEnUS,
  UniverSheetsEnUS,
  UniverSheetsUIEnUS,
  UniverSheetsFormulaUIEnUS,
  UniverSheetsNumfmtUIEnUS,
);

export const SHEET_LOCALES = {
  [LocaleType.EN_US]: enUS,
};
