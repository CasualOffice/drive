Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
let _univerjs_core = require("@univerjs/core");
let _univerjs_docs = require("@univerjs/docs");
let _univerjs_docs_ui = require("@univerjs/docs-ui");
let rxjs = require("rxjs");
let _univerjs_ui = require("@univerjs/ui");
let react = require("react");
let _univerjs_design = require("@univerjs/design");
let react_jsx_runtime = require("react/jsx-runtime");

//#region package.json
var name = "@univerjs/docs-mention-ui";
var version = "0.25.0";

//#endregion
//#region src/config/config.ts
const DOCS_MENTION_UI_PLUGIN_CONFIG_KEY = "docs-mention-ui.config";
const configSymbol = Symbol(DOCS_MENTION_UI_PLUGIN_CONFIG_KEY);
const defaultPluginConfig = {};

//#endregion
//#region \0@oxc-project+runtime@0.133.0/helpers/esm/typeof.js
function _typeof(o) {
	"@babel/helpers - typeof";
	return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
		return typeof o;
	} : function(o) {
		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
	}, _typeof(o);
}

//#endregion
//#region \0@oxc-project+runtime@0.133.0/helpers/esm/toPrimitive.js
function toPrimitive(t, r) {
	if ("object" != _typeof(t) || !t) return t;
	var e = t[Symbol.toPrimitive];
	if (void 0 !== e) {
		var i = e.call(t, r || "default");
		if ("object" != _typeof(i)) return i;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return ("string" === r ? String : Number)(t);
}

//#endregion
//#region \0@oxc-project+runtime@0.133.0/helpers/esm/toPropertyKey.js
function toPropertyKey(t) {
	var i = toPrimitive(t, "string");
	return "symbol" == _typeof(i) ? i : i + "";
}

//#endregion
//#region \0@oxc-project+runtime@0.133.0/helpers/esm/defineProperty.js
function _defineProperty(e, r, t) {
	return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
		value: t,
		enumerable: !0,
		configurable: !0,
		writable: !0
	}) : e[r] = t, e;
}

//#endregion
//#region src/services/doc-mention.service.ts
var DocMentionService = class extends _univerjs_core.Disposable {
	get editing() {
		return this._editing$.value;
	}
	constructor() {
		super();
		_defineProperty(this, "_editing$", new rxjs.BehaviorSubject(void 0));
		_defineProperty(this, "editing$", this._editing$.asObservable());
		this.disposeWithMe(() => {
			this._editing$.complete();
		});
	}
	startEditing(item) {
		this._editing$.next(item);
	}
	endEditing() {
		this._editing$.next(void 0);
	}
};

//#endregion
//#region src/commands/operations/mention-popup.operation.ts
const ShowMentionInfoPopupOperation = {
	type: _univerjs_core.CommandType.OPERATION,
	id: "doc.operation.show-mention-info-popup",
	handler(accessor, params) {
		return false;
	}
};
const CloseMentionInfoPopupOperation = {
	type: _univerjs_core.CommandType.OPERATION,
	id: "doc.operation.close-mention-info-popup",
	handler(accessor) {
		return false;
	}
};
const ShowMentionEditPopupOperation = {
	type: _univerjs_core.CommandType.OPERATION,
	id: "doc.operation.show-mention-edit-popup",
	handler(accessor, params) {
		if (!params) return false;
		accessor.get(DocMentionService).startEditing({
			unitId: params.unitId,
			index: params.startIndex
		});
		return true;
	}
};
const CloseMentionEditPopupOperation = {
	type: _univerjs_core.CommandType.OPERATION,
	id: "doc.operation.close-mention-edit-popup",
	handler(accessor) {
		accessor.get(DocMentionService).endEditing();
		return true;
	}
};

//#endregion
//#region src/commands/commands/doc-mention.command.ts
const AddDocMentionCommand = {
	type: _univerjs_core.CommandType.COMMAND,
	id: "docs.command.add-doc-mention",
	handler: async (accessor, params) => {
		if (!params) return false;
		const { mention, unitId, startIndex } = params;
		const commandService = accessor.get(_univerjs_core.ICommandService);
		const activeRange = accessor.get(_univerjs_docs.DocSelectionManagerService).getActiveTextRange();
		if (!activeRange) return false;
		const { metadata, ...mentionConfig } = mention;
		const dataStream = `@${mention.label}`;
		const doMutation = (0, _univerjs_docs.replaceSelectionFactory)(accessor, {
			unitId,
			body: {
				dataStream,
				customRanges: [{
					startIndex: 0,
					endIndex: dataStream.length - 1,
					rangeId: mention.id,
					rangeType: _univerjs_core.CustomRangeType.MENTION,
					wholeEntity: true,
					properties: {
						...mentionConfig,
						...metadata
					}
				}]
			},
			selection: {
				startOffset: startIndex,
				endOffset: activeRange.endOffset,
				collapsed: startIndex === activeRange.endOffset
			}
		});
		if (doMutation) return commandService.syncExecuteCommand(doMutation.id, doMutation.params);
		return false;
	}
};
const DeleteDocMentionCommand = {
	type: _univerjs_core.CommandType.COMMAND,
	id: "docs.command.delete-doc-mention",
	async handler(accessor, params) {
		if (!params) return false;
		const { unitId, mentionId } = params;
		const commandService = accessor.get(_univerjs_core.ICommandService);
		const doMutation = (0, _univerjs_docs.deleteCustomRangeFactory)(accessor, {
			unitId,
			rangeId: mentionId
		});
		if (!doMutation) return false;
		return await commandService.syncExecuteCommand(doMutation.id, doMutation.params);
	}
};

//#endregion
//#region src/views/mention-list/index.tsx
const MentionList = (props) => {
	var _mentions$;
	const { mentions, active, onSelect, onClick, editorId } = props;
	const ref = (0, react.useRef)(null);
	const [activeId, setActiveId] = (0, react.useState)(active !== null && active !== void 0 ? active : (_mentions$ = mentions[0]) === null || _mentions$ === void 0 || (_mentions$ = _mentions$.mentions[0]) === null || _mentions$ === void 0 ? void 0 : _mentions$.objectId);
	const handleSelect = (item) => {
		onSelect === null || onSelect === void 0 || onSelect(item);
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		ref,
		"data-editorid": editorId,
		tabIndex: 0,
		className: (0, _univerjs_design.clsx)("univer-max-h-72 univer-w-72 univer-overflow-hidden univer-rounded-lg univer-bg-white univer-p-2 univer-shadow-md", _univerjs_design.borderClassName),
		onClick,
		children: mentions.map((typeMentions) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "univer-mb-2 univer-font-medium",
			children: typeMentions.title
		}), typeMentions.mentions.map((mention) => {
			var _mention$metadata;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-editorid": editorId,
				className: (0, _univerjs_design.clsx)("univer-flex univer-cursor-pointer univer-items-center univer-rounded-md univer-p-2", { "univer-bg-gray-50": activeId === mention.objectId }),
				onClick: () => handleSelect(mention),
				onMouseEnter: () => setActiveId(mention.objectId),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					className: "univer-pointer-events-none univer-mr-1.5 univer-size-6 univer-flex-[0_0_auto] univer-rounded-md hover:univer-bg-gray-50",
					src: (_mention$metadata = mention.metadata) === null || _mention$metadata === void 0 ? void 0 : _mention$metadata.icon
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "univer-pointer-events-none univer-flex-1 univer-truncate",
					children: mention.label
				})]
			}, mention.objectId);
		})] }, typeMentions.type))
	});
};

//#endregion
//#region src/views/mention-edit-popup/index.tsx
const MentionEditPopup = () => {
	var _documentDataModel$ge;
	const popupService = (0, _univerjs_ui.useDependency)(DocMentionPopupService);
	const commandService = (0, _univerjs_ui.useDependency)(_univerjs_core.ICommandService);
	const univerInstanceService = (0, _univerjs_ui.useDependency)(_univerjs_core.IUniverInstanceService);
	const editPopup = (0, _univerjs_ui.useObservable)(popupService.editPopup$);
	const mentionIOService = (0, _univerjs_ui.useDependency)(_univerjs_core.IMentionIOService);
	const editorService = (0, _univerjs_ui.useDependency)(_univerjs_docs_ui.IEditorService);
	const documentDataModel = editPopup ? univerInstanceService.getUnit(editPopup.unitId) : null;
	const textSelectionService = (0, _univerjs_ui.useDependency)(_univerjs_docs.DocSelectionManagerService);
	const [mentions, setMentions] = (0, react.useState)([]);
	const textSelection = (0, _univerjs_ui.useObservable)((0, react.useMemo)(() => textSelectionService.textSelection$.pipe((0, rxjs.filter)((selection) => selection.unitId === (editPopup === null || editPopup === void 0 ? void 0 : editPopup.unitId))), [textSelectionService.textSelection$, editPopup]));
	const search = editPopup ? documentDataModel === null || documentDataModel === void 0 || (_documentDataModel$ge = documentDataModel.getBody()) === null || _documentDataModel$ge === void 0 ? void 0 : _documentDataModel$ge.dataStream.slice(editPopup.anchor, textSelection === null || textSelection === void 0 ? void 0 : textSelection.textRanges[0].startOffset) : "";
	(0, react.useEffect)(() => {
		(async () => {
			if (editPopup) setMentions((await mentionIOService.list({
				unitId: editPopup.unitId,
				search
			})).list);
		})();
	}, [
		mentionIOService,
		editPopup,
		search
	]);
	if (!editPopup) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MentionList, {
		editorId: editPopup.unitId,
		onClick: () => {
			popupService.closeEditPopup();
			editorService.focus(editPopup.unitId);
		},
		mentions,
		onSelect: async (mention) => {
			await commandService.executeCommand(AddDocMentionCommand.id, {
				unitId: univerInstanceService.getCurrentUnitOfType(_univerjs_core.UniverInstanceType.UNIVER_DOC).getUnitId(),
				mention: {
					...mention,
					id: (0, _univerjs_core.generateRandomId)()
				},
				startIndex: editPopup.anchor
			});
			editorService.focus(editPopup.unitId);
		}
	});
};
MentionEditPopup.componentKey = "univer.popup.doc-mention-edit";

//#endregion
//#region \0@oxc-project+runtime@0.133.0/helpers/esm/decorateParam.js
function __decorateParam(paramIndex, decorator) {
	return function(target, key) {
		decorator(target, key, paramIndex);
	};
}

//#endregion
//#region \0@oxc-project+runtime@0.133.0/helpers/esm/decorate.js
function __decorate(decorators, target, key, desc) {
	var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
	if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
	else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
	return c > 3 && r && Object.defineProperty(target, key, r), r;
}

//#endregion
//#region src/services/doc-mention-popup.service.ts
let DocMentionPopupService = class DocMentionPopupService extends _univerjs_core.Disposable {
	get infoPopup() {
		return this._infoPopup$.value;
	}
	get editPopup() {
		return this._editPopup$.value;
	}
	constructor(_docCanvasPopupManagerService, _docMentionService) {
		super();
		this._docCanvasPopupManagerService = _docCanvasPopupManagerService;
		this._docMentionService = _docMentionService;
		_defineProperty(this, "_infoPopup$", new rxjs.BehaviorSubject(void 0));
		_defineProperty(this, "infoPopup$", this._infoPopup$.asObservable());
		_defineProperty(this, "_editPopup$", new rxjs.BehaviorSubject(void 0));
		_defineProperty(this, "editPopup$", this._editPopup$.asObservable());
		this.disposeWithMe(this._docMentionService.editing$.subscribe((editing) => {
			if (editing !== void 0 && editing !== null) this.showEditPopup(editing.unitId, editing.index);
			else this.closeEditPopup();
		}));
	}
	showInfoPopup() {}
	closeInfoPopup() {}
	showEditPopup(unitId, index) {
		this.closeEditPopup();
		const dispose = this._docCanvasPopupManagerService.attachPopupToRange({
			startOffset: index,
			endOffset: index,
			collapsed: true
		}, {
			componentKey: MentionEditPopup.componentKey,
			onClickOutside: () => {
				this.closeEditPopup();
			},
			direction: "bottom"
		}, unitId);
		this._editPopup$.next({
			popup: dispose,
			anchor: index,
			unitId
		});
	}
	closeEditPopup() {
		if (!(this._docMentionService.editing == null)) this._docMentionService.endEditing();
		if (this.editPopup) {
			this.editPopup.popup.dispose();
			this._editPopup$.next(null);
		}
	}
};
DocMentionPopupService = __decorate([__decorateParam(0, (0, _univerjs_core.Inject)(_univerjs_docs_ui.DocCanvasPopManagerService)), __decorateParam(1, (0, _univerjs_core.Inject)(DocMentionService))], DocMentionPopupService);

//#endregion
//#region src/controllers/doc-mention-trigger.controller.ts
let DocMentionTriggerController = class DocMentionTriggerController extends _univerjs_core.Disposable {
	constructor(_commandService, _docMentionService, _textSelectionManagerService, _docMentionPopupService) {
		super();
		this._commandService = _commandService;
		this._docMentionService = _docMentionService;
		this._textSelectionManagerService = _textSelectionManagerService;
		this._docMentionPopupService = _docMentionPopupService;
		this._initTrigger();
	}
	_initTrigger() {
		this.disposeWithMe(this._commandService.onCommandExecuted((commandInfo) => {
			if (commandInfo.id === _univerjs_docs_ui.InsertCommand.id) {
				const params = commandInfo.params;
				const activeRange = this._textSelectionManagerService.getActiveTextRange();
				if (params.body.dataStream === "@" && activeRange && !_univerjs_core.Tools.isDefine(this._docMentionService.editing)) setTimeout(() => {
					this._commandService.executeCommand(ShowMentionEditPopupOperation.id, {
						startIndex: activeRange.startOffset - 1,
						unitId: params.unitId
					});
				}, 100);
			}
			if (commandInfo.id === _univerjs_docs_ui.MoveCursorOperation.id) this._commandService.executeCommand(CloseMentionEditPopupOperation.id);
			if (commandInfo.id === _univerjs_docs_ui.DeleteLeftCommand.id) {
				if (this._docMentionPopupService.editPopup == null) return;
				const activeRange = this._textSelectionManagerService.getActiveTextRange();
				if (activeRange && activeRange.endOffset <= this._docMentionPopupService.editPopup.anchor) this._commandService.executeCommand(CloseMentionEditPopupOperation.id);
			}
		}));
	}
};
DocMentionTriggerController = __decorate([
	__decorateParam(0, _univerjs_core.ICommandService),
	__decorateParam(1, (0, _univerjs_core.Inject)(DocMentionService)),
	__decorateParam(2, (0, _univerjs_core.Inject)(_univerjs_docs.DocSelectionManagerService)),
	__decorateParam(3, (0, _univerjs_core.Inject)(DocMentionPopupService))
], DocMentionTriggerController);

//#endregion
//#region src/controllers/doc-mention-ui.controller.ts
/**
* Copyright 2023-present DreamNum Co., Ltd.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
let DocMentionUIController = class DocMentionUIController extends _univerjs_core.Disposable {
	constructor(_commandService, _componentManager) {
		super();
		this._commandService = _commandService;
		this._componentManager = _componentManager;
		this._initCommands();
		this._initComponents();
	}
	_initCommands() {
		[
			ShowMentionInfoPopupOperation,
			CloseMentionInfoPopupOperation,
			ShowMentionEditPopupOperation,
			CloseMentionEditPopupOperation,
			AddDocMentionCommand,
			DeleteDocMentionCommand
		].forEach((operation) => {
			this.disposeWithMe(this._commandService.registerCommand(operation));
		});
	}
	_initComponents() {
		[[MentionEditPopup.componentKey, MentionEditPopup]].forEach(([key, comp]) => {
			this.disposeWithMe(this._componentManager.register(key, comp));
		});
	}
};
DocMentionUIController = __decorate([__decorateParam(0, _univerjs_core.ICommandService), __decorateParam(1, (0, _univerjs_core.Inject)(_univerjs_ui.ComponentManager))], DocMentionUIController);

//#endregion
//#region src/types/const/const.ts
/**
* Copyright 2023-present DreamNum Co., Ltd.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
const DOC_MENTION_UI_PLUGIN = "DOC_MENTION_UI_PLUGIN";

//#endregion
//#region src/plugin.ts
let UniverDocsMentionUIPlugin = class UniverDocsMentionUIPlugin extends _univerjs_core.Plugin {
	constructor(_config = defaultPluginConfig, _injector, _configService) {
		super();
		this._config = _config;
		this._injector = _injector;
		this._configService = _configService;
		const { menu, ...rest } = (0, _univerjs_core.merge)({}, defaultPluginConfig, this._config);
		if (menu) this._configService.setConfig("menu", menu, { merge: true });
		this._configService.setConfig(DOCS_MENTION_UI_PLUGIN_CONFIG_KEY, rest);
	}
	onStarting() {
		[
			[DocMentionService],
			[DocMentionPopupService],
			[DocMentionUIController],
			[DocMentionTriggerController]
		].forEach((dep) => {
			this._injector.add(dep);
		});
		this._injector.get(DocMentionUIController);
	}
	onRendered() {
		this._injector.get(DocMentionTriggerController);
		this._injector.get(DocMentionPopupService);
	}
};
_defineProperty(UniverDocsMentionUIPlugin, "pluginName", DOC_MENTION_UI_PLUGIN);
_defineProperty(UniverDocsMentionUIPlugin, "packageName", name);
_defineProperty(UniverDocsMentionUIPlugin, "version", version);
_defineProperty(UniverDocsMentionUIPlugin, "type", _univerjs_core.UniverInstanceType.UNIVER_DOC);
UniverDocsMentionUIPlugin = __decorate([__decorateParam(1, (0, _univerjs_core.Inject)(_univerjs_core.Injector)), __decorateParam(2, _univerjs_core.IConfigService)], UniverDocsMentionUIPlugin);

//#endregion
Object.defineProperty(exports, 'DocMentionPopupService', {
  enumerable: true,
  get: function () {
    return DocMentionPopupService;
  }
});
Object.defineProperty(exports, 'UniverDocsMentionUIPlugin', {
  enumerable: true,
  get: function () {
    return UniverDocsMentionUIPlugin;
  }
});