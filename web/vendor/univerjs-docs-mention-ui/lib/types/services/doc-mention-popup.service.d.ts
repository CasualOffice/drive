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
import type { IDisposable, Nullable } from '@univerjs/core';
import { Disposable } from '@univerjs/core';
import { DocCanvasPopManagerService } from '@univerjs/docs-ui';
import { DocMentionService } from './doc-mention.service';
export declare class DocMentionPopupService extends Disposable {
    private readonly _docCanvasPopupManagerService;
    private readonly _docMentionService;
    private readonly _infoPopup$;
    readonly infoPopup$: import("rxjs").Observable<undefined>;
    get infoPopup(): undefined;
    private readonly _editPopup$;
    readonly editPopup$: import("rxjs").Observable<Nullable<{
        anchor: number;
        popup: IDisposable;
        unitId: string;
    }>>;
    get editPopup(): Nullable<{
        anchor: number;
        popup: IDisposable;
        unitId: string;
    }>;
    constructor(_docCanvasPopupManagerService: DocCanvasPopManagerService, _docMentionService: DocMentionService);
    showInfoPopup(): void;
    closeInfoPopup(): void;
    showEditPopup(unitId: string, index: number): void;
    closeEditPopup(): void;
}
