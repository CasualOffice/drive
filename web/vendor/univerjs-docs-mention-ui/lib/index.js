import { CommandType, CustomRangeType, Disposable, ICommandService, IConfigService, IMentionIOService, IUniverInstanceService, Inject, Injector, Plugin, Tools, UniverInstanceType, generateRandomId, merge } from "@univerjs/core";
import { DocSelectionManagerService, deleteCustomRangeFactory, replaceSelectionFactory } from "@univerjs/docs";
import { DeleteLeftCommand, DocCanvasPopManagerService, IEditorService, InsertCommand, MoveCursorOperation } from "@univerjs/docs-ui";
import { BehaviorSubject, filter } from "rxjs";
import { ComponentManager, useDependency, useObservable } from "@univerjs/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { borderClassName, clsx } from "@univerjs/design";
import { jsx, jsxs } from "react/jsx-runtime";

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
var DocMentionService = class extends Disposable {
	get editing() {
		return this._editing$.value;
	}
	constructor() {
		super();
		_defineProperty(this, "_editing$", new BehaviorSubject(void 0));
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
	type: CommandType.OPERATION,
	id: "doc.operation.show-mention-info-popup",
	handler(accessor, params) {
		return false;
	}
};
const CloseMentionInfoPopupOperation = {
	type: CommandType.OPERATION,
	id: "doc.operation.close-mention-info-popup",
	handler(accessor) {
		return false;
	}
};
const ShowMentionEditPopupOperation = {
	type: CommandType.OPERATION,
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
	type: CommandType.OPERATION,
	id: "doc.operation.close-mention-edit-popup",
	handler(accessor) {
		accessor.get(DocMentionService).endEditing();
		return true;
	}
};

//#endregion
//#region src/commands/commands/doc-mention.command.ts
const AddDocMentionCommand = {
	type: CommandType.COMMAND,
	id: "docs.command.add-doc-mention",
	handler: async (accessor, params) => {
		if (!params) return false;
		const { mention, unitId, startIndex } = params;
		const commandService = accessor.get(ICommandService);
		const activeRange = accessor.get(DocSelectionManagerService).getActiveTextRange();
		if (!activeRange) return false;
		const { metadata, ...mentionConfig } = mention;
		const dataStream = `@${mention.label}`;
		const doMutation = replaceSelectionFactory(accessor, {
			unitId,
			body: {
				dataStream,
				customRanges: [{
					startIndex: 0,
					endIndex: dataStream.length - 1,
					rangeId: mention.id,
					rangeType: CustomRangeType.MENTION,
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
	type: CommandType.COMMAND,
	id: "docs.command.delete-doc-mention",
	async handler(accessor, params) {
		if (!params) return false;
		const { unitId, mentionId } = params;
		const commandService = accessor.get(ICommandService);
		const doMutation = deleteCustomRangeFactory(accessor, {
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
	const ref = useRef(null);
	const [activeId, setActiveId] = useState(active !== null && active !== void 0 ? active : (_mentions$ = mentions[0]) === null || _mentions$ === void 0 || (_mentions$ = _mentions$.mentions[0]) === null || _mentions$ === void 0 ? void 0 : _mentions$.objectId);
	const handleSelect = (item) => {
		onSelect === null || onSelect === void 0 || onSelect(item);
	};
	return /* @__PURE__ */ jsx("div", {
		ref,
		"data-editorid": editorId,
		tabIndex: 0,
		className: clsx("univer-max-h-72 univer-w-72 univer-overflow-hidden univer-rounded-lg univer-bg-white univer-p-2 univer-shadow-md", borderClassName),
		onClick,
		children: mentions.map((typeMentions) => /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("div", {
			className: "univer-mb-2 univer-font-medium",
			children: typeMentions.title
		}), typeMentions.mentions.map((mention) => {
			var _mention$metadata;
			return /* @__PURE__ */ jsxs("div", {
				"data-editorid": editorId,
				className: clsx("univer-flex univer-cursor-pointer univer-items-center univer-rounded-md univer-p-2", { "univer-bg-gray-50": activeId === mention.objectId }),
				onClick: () => handleSelect(mention),
				onMouseEnter: () => setActiveId(mention.objectId),
				children: [/* @__PURE__ */ jsx("img", {
					className: "univer-pointer-events-none univer-mr-1.5 univer-size-6 univer-flex-[0_0_auto] univer-rounded-md hover:univer-bg-gray-50",
					src: (_mention$metadata = mention.metadata) === null || _mention$metadata === void 0 ? void 0 : _mention$metadata.icon
				}), /* @__PURE__ */ jsx("div", {
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
	const popupService = useDependency(DocMentionPopupService);
	const commandService = useDependency(ICommandService);
	const univerInstanceService = useDependency(IUniverInstanceService);
	const editPopup = useObservable(popupService.editPopup$);
	const mentionIOService = useDependency(IMentionIOService);
	const editorService = useDependency(IEditorService);
	const documentDataModel = editPopup ? univerInstanceService.getUnit(editPopup.unitId) : null;
	const textSelectionService = useDependency(DocSelectionManagerService);
	const [mentions, setMentions] = useState([]);
	const textSelection = useObservable(useMemo(() => textSelectionService.textSelection$.pipe(filter((selection) => selection.unitId === (editPopup === null || editPopup === void 0 ? void 0 : editPopup.unitId))), [textSelectionService.textSelection$, editPopup]));
	const search = editPopup ? documentDataModel === null || documentDataModel === void 0 || (_documentDataModel$ge = documentDataModel.getBody()) === null || _documentDataModel$ge === void 0 ? void 0 : _documentDataModel$ge.dataStream.slice(editPopup.anchor, textSelection === null || textSelection === void 0 ? void 0 : textSelection.textRanges[0].startOffset) : "";
	useEffect(() => {
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
	return /* @__PURE__ */ jsx(MentionList, {
		editorId: editPopup.unitId,
		onClick: () => {
			popupService.closeEditPopup();
			editorService.focus(editPopup.unitId);
		},
		mentions,
		onSelect: async (mention) => {
			await commandService.executeCommand(AddDocMentionCommand.id, {
				unitId: univerInstanceService.getCurrentUnitOfType(UniverInstanceType.UNIVER_DOC).getUnitId(),
				mention: {
					...mention,
					id: generateRandomId()
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
let DocMentionPopupService = class DocMentionPopupService extends Disposable {
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
		_defineProperty(this, "_infoPopup$", new BehaviorSubject(void 0));
		_defineProperty(this, "infoPopup$", this._infoPopup$.asObservable());
		_defineProperty(this, "_editPopup$", new BehaviorSubject(void 0));
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
DocMentionPopupService = __decorate([__decorateParam(0, Inject(DocCanvasPopManagerService)), __decorateParam(1, Inject(DocMentionService))], DocMentionPopupService);

//#endregion
//#region src/controllers/doc-mention-trigger.controller.ts
let DocMentionTriggerController = class DocMentionTriggerController extends Disposable {
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
			if (commandInfo.id === InsertCommand.id) {
				const params = commandInfo.params;
				const activeRange = this._textSelectionManagerService.getActiveTextRange();
				if (params.body.dataStream === "@" && activeRange && !Tools.isDefine(this._docMentionService.editing)) setTimeout(() => {
					this._commandService.executeCommand(ShowMentionEditPopupOperation.id, {
						startIndex: activeRange.startOffset - 1,
						unitId: params.unitId
					});
				}, 100);
			}
			if (commandInfo.id === MoveCursorOperation.id) this._commandService.executeCommand(CloseMentionEditPopupOperation.id);
			if (commandInfo.id === DeleteLeftCommand.id) {
				if (this._docMentionPopupService.editPopup == null) return;
				const activeRange = this._textSelectionManagerService.getActiveTextRange();
				if (activeRange && activeRange.endOffset <= this._docMentionPopupService.editPopup.anchor) this._commandService.executeCommand(CloseMentionEditPopupOperation.id);
			}
		}));
	}
};
DocMentionTriggerController = __decorate([
	__decorateParam(0, ICommandService),
	__decorateParam(1, Inject(DocMentionService)),
	__decorateParam(2, Inject(DocSelectionManagerService)),
	__decorateParam(3, Inject(DocMentionPopupService))
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
let DocMentionUIController = class DocMentionUIController extends Disposable {
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
DocMentionUIController = __decorate([__decorateParam(0, ICommandService), __decorateParam(1, Inject(ComponentManager))], DocMentionUIController);

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
let UniverDocsMentionUIPlugin = class UniverDocsMentionUIPlugin extends Plugin {
	constructor(_config = defaultPluginConfig, _injector, _configService) {
		super();
		this._config = _config;
		this._injector = _injector;
		this._configService = _configService;
		const { menu, ...rest } = merge({}, defaultPluginConfig, this._config);
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
_defineProperty(UniverDocsMentionUIPlugin, "type", UniverInstanceType.UNIVER_DOC);
UniverDocsMentionUIPlugin = __decorate([__decorateParam(1, Inject(Injector)), __decorateParam(2, IConfigService)], UniverDocsMentionUIPlugin);

//#endregion
export { DocMentionPopupService, UniverDocsMentionUIPlugin };