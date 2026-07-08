/**
 * English (en-US) locale bundle for the native `<CasualSheets>` mount.
 *
 * Univer's LocaleService is NOT self-initialising in this SDK build: mounting
 * `<CasualSheets>` WITHOUT a `locales` prop leaves the service empty and the
 * render engine throws "[LocaleService]: Locale not initialized" the moment it
 * tries to paint the grid — the chrome (React toolbar/menus) renders, but no
 * grid canvas ever mounts. (The retired iframe embed dodged this because its
 * self-contained `embed-runtime` bundled the locale strings internally.)
 *
 * So the host must supply the merged string bundle. This mirrors the reference
 * Casual Sheets app's `locale.ts`, minus its two app-only plugins
 * (`sheets-crosshair-highlight`, `sheets-zen-editor`) which aren't in the SDK's
 * peer set. Each `-ui` package ships panel chrome; the matching base packages
 * ship validator/label/error strings — both are merged so no panel renders raw
 * i18n keys. `@univerjs/sheets-find-replace` no longer ships its own locale in
 * 0.25 (consolidated into `@univerjs/find-replace`).
 *
 * This module is pulled into the lazy CasualSheetWorkspace chunk, so the ~two
 * dozen locale imports never touch the main bundle.
 */

import { LocaleType, Tools } from "@univerjs/core";

import UniverSheetsEnUS from "@univerjs/sheets/locale/en-US";
import UniverSheetsUIEnUS from "@univerjs/sheets-ui/locale/en-US";
import UniverSheetsFormulaEnUS from "@univerjs/sheets-formula/locale/en-US";
import UniverSheetsFormulaUIEnUS from "@univerjs/sheets-formula-ui/locale/en-US";
import UniverSheetsSortUIEnUS from "@univerjs/sheets-sort-ui/locale/en-US";
import UniverSheetsFilterUIEnUS from "@univerjs/sheets-filter-ui/locale/en-US";
import UniverSheetsNumfmtUIEnUS from "@univerjs/sheets-numfmt-ui/locale/en-US";
import UniverFindReplaceEnUS from "@univerjs/find-replace/locale/en-US";
import UniverSheetsConditionalFormattingUIEnUS from "@univerjs/sheets-conditional-formatting-ui/locale/en-US";
import UniverDataValidationEnUS from "@univerjs/data-validation/locale/en-US";
import UniverSheetsDataValidationEnUS from "@univerjs/sheets-data-validation/locale/en-US";
import UniverSheetsDataValidationUIEnUS from "@univerjs/sheets-data-validation-ui/locale/en-US";
import UniverSheetsFilterEnUS from "@univerjs/sheets-filter/locale/en-US";
import UniverSheetsHyperLinkEnUS from "@univerjs/sheets-hyper-link/locale/en-US";
import UniverSheetsTableEnUS from "@univerjs/sheets-table/locale/en-US";
import UniverSheetsHyperLinkUIEnUS from "@univerjs/sheets-hyper-link-ui/locale/en-US";
import UniverSheetsNoteUIEnUS from "@univerjs/sheets-note-ui/locale/en-US";
import UniverSheetsTableUIEnUS from "@univerjs/sheets-table-ui/locale/en-US";
import UniverThreadCommentUIEnUS from "@univerjs/thread-comment-ui/locale/en-US";
import UniverSheetsThreadCommentUIEnUS from "@univerjs/sheets-thread-comment-ui/locale/en-US";
import UniverDrawingUIEnUS from "@univerjs/drawing-ui/locale/en-US";
import UniverSheetsDrawingUIEnUS from "@univerjs/sheets-drawing-ui/locale/en-US";
import UniverDocsUIEnUS from "@univerjs/docs-ui/locale/en-US";
import UniverUIEnUS from "@univerjs/ui/locale/en-US";

const enUS = Tools.deepMerge(
  {},
  UniverSheetsEnUS,
  UniverSheetsUIEnUS,
  UniverSheetsFormulaEnUS,
  UniverSheetsFormulaUIEnUS,
  UniverSheetsSortUIEnUS,
  UniverSheetsFilterUIEnUS,
  UniverSheetsNumfmtUIEnUS,
  UniverFindReplaceEnUS,
  UniverSheetsConditionalFormattingUIEnUS,
  UniverDataValidationEnUS,
  UniverSheetsDataValidationEnUS,
  UniverSheetsDataValidationUIEnUS,
  UniverSheetsFilterEnUS,
  UniverSheetsHyperLinkEnUS,
  UniverSheetsTableEnUS,
  UniverSheetsHyperLinkUIEnUS,
  UniverSheetsNoteUIEnUS,
  UniverSheetsTableUIEnUS,
  UniverThreadCommentUIEnUS,
  UniverSheetsThreadCommentUIEnUS,
  UniverDrawingUIEnUS,
  UniverSheetsDrawingUIEnUS,
  UniverDocsUIEnUS,
  UniverUIEnUS,
);

export const SHEET_LOCALES = {
  [LocaleType.EN_US]: enUS,
};
