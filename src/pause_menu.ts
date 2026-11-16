import { BoundKey, resolveBoundKey, stripMarkup } from './keys';
import { Pmx, wait } from './pmx';
import { PREF_TEXT_IDS, SETTINGS_TAB_MENU_IDS, SettingsTab } from './prefs';

const LANDING_MENU = 'FE_MENU_VERSION_LANDING_MENU';
const MENU_UNIQUE_ID_SETTINGS = 6;
const PM_READY = 15;
const PM_SHUTTING_DOWN = 30;
const CONCEAL_LOAD_MS = 5000;
const CONCEAL_AFTER_STEALTH_MS = 1500;
const PLAYER_CONTROL = 0;
const FRONTEND_CONTROL = 2;
const REBIND_TIMEOUT_MS = 30000;
const SIMULATED_INPUT_FRAMES = 3;
const INPUT_THROTTLE_MS = 200;
const CLEAR_SLOT_REFRESH_MS = 400;
const POSTFX_CLEANUP_MS = 1500;

const PAUSE_MENU_POSTFX = [
    'PauseMenuIn', 'PauseMenuOut',
    'PauseMenuFranklinIn', 'PauseMenuFranklinOut',
    'PauseMenuMichaelIn', 'PauseMenuMichaelOut',
    'PauseMenuTrevorIn', 'PauseMenuTrevorOut',
];

export const FrontendInput = {
    Down: 187,
    Up: 188,
    Left: 189,
    Right: 190,
    Pause: 199,
    PauseAlternate: 200,
    Accept: 201,
    Cancel: 202,
    X: 203,
    Y: 204,
    LB: 205,
    RB: 206,
    LT: 207,
    RT: 208,
    Delete: 214,
} as const;

export type SettingKind = 'pref' | 'action' | 'separator' | 'empty' | 'display';
export type SettingControl = 'list' | 'slider' | 'none';
export type MenuPage = 'none' | 'settings' | 'keymap' | 'other';
export type WarningChoice = 'yes' | 'no' | 'alt';
export type WarningKind =
    | 'keepSettings' | 'restartRequired' | 'onlineWarning'
    | 'keymapConflict' | 'keymapUnmappable' | 'keymapAutosave' | 'keymapRestore'
    | 'keymapCantLeave' | 'keymapLeaveConflict' | 'keymapLeaveUnmapped'
    | 'unknown';

export interface MenuState {
    menuId: number;
    level: number;
    uniqueId: number;
    categoryRow: number;
    settingRow: number;
    highlightedPrefId: number;
    page: MenuPage;
    stealth: boolean;
    revision: number;
}

export interface SettingRow {
    row: number;
    prefId: number;
    kind: SettingKind;
    control: SettingControl;
    value: number;
    max: number;
    active: number;
    codeBuilt: boolean;
    label: string;
    options: string[];
    textId: string | null;
}

export interface VideoMemory {
    used: number;
    total: number;
    percent: number;
}

export interface SettingsPage {
    tab: SettingsTab;
    rows: SettingRow[];
    gfxDirty: boolean;
    videoMemory: VideoMemory | null;
}

export interface KeymapCategory {
    index: number;
    label: string;
    alert: boolean;
    kind: 'category' | 'restore';
}

export interface KeymapRow {
    row: number;
    label: string;
    state: number;
    alert: boolean;
    mappable: boolean;
    tokens: [string, string];
    slots: [BoundKey, BoundKey];
}

export interface KeymapPage {
    tab: 'keymap';
    categories: KeymapCategory[];
    category: number | null;
    rows: KeymapRow[];
    capturing: boolean;
}

interface KeymapState {
    inKeymap: boolean;
    menuLevel: number;
    categoryRow: number;
    capturing: boolean;
}

interface RawRow {
    prefId: number;
    style: number;
    value: number;
    max: number;
    active: number;
    optionCount: number;
    codeBuilt: boolean;
    kind: SettingKind;
}

interface CachedTexts {
    label: string;
    options: string[];
}

const WARNING_CHOICE_INPUTS: Record<WarningChoice, number> = {
    yes: FrontendInput.Accept,
    no: FrontendInput.Cancel,
    alt: FrontendInput.X,
};

const WARNING_KINDS: Record<number, WarningKind> = {
    [GetHashKey('GFX_WARNING_BODY') >>> 0]: 'keepSettings',
    [GetHashKey('GFX_RESTART_BODY') >>> 0]: 'restartRequired',
    [GetHashKey('GFX_WARNING_MP') >>> 0]: 'onlineWarning',
    [GetHashKey('MAPPING_CONFLICT_BODY') >>> 0]: 'keymapConflict',
    [GetHashKey('MAPPING_MULTI_CONFLICT_BODY') >>> 0]: 'keymapConflict',
    [GetHashKey('UNMAPPABLE_CONFLICT_BODY') >>> 0]: 'keymapUnmappable',
    [GetHashKey('MAPPING_AUTOSAVE_LOADED') >>> 0]: 'keymapAutosave',
    [GetHashKey('MAPPING_RESTORE_DEFAULTS') >>> 0]: 'keymapRestore',
    [GetHashKey('UNMAPPED_WARNING_NO_ESCAPE') >>> 0]: 'keymapCantLeave',
    [GetHashKey('CONFLICT_WARNING') >>> 0]: 'keymapLeaveConflict',
    [GetHashKey('UNMAPPED_WARNING') >>> 0]: 'keymapLeaveUnmapped',
};

const MENU_PAGES: readonly MenuPage[] = ['none', 'settings', 'keymap', 'other'];
const GRAPHICS_TABS: ReadonlySet<SettingsTab> = new Set<SettingsTab>(['graphics', 'advgfx']);

function parseMenuState(raw: string | null): MenuState {
    const [menuId, level, uniqueId, categoryRow, settingRow, highlightedPrefId, page, stealth, revision] = (raw ?? '').split('|').map(Number);
    return { menuId, level, uniqueId, categoryRow, settingRow, highlightedPrefId, page: MENU_PAGES[page] ?? 'none', stealth: stealth === 1, revision };
}

function parseKeymapState(raw: string | null): KeymapState {
    const [inKeymap, menuLevel, categoryRow, , , capturing] = (raw ?? '').split('|').map(Number);
    return { inKeymap: inKeymap === 1, menuLevel, categoryRow, capturing: capturing === 1 };
}

function parseRow(raw: string): RawRow | null {
    const parts = raw.split('|');
    if (parts.length < 9) return null;
    const [prefId, style, value, max, active, , optionCount, codeBuilt] = parts.map(Number);
    return { prefId, style, value, max, active, optionCount, codeBuilt: codeBuilt === 1, kind: parts[8] as SettingKind };
}

function controlOf(style: number): SettingControl {
    if (style === 1 || (style >= 10 && style < 20)) return 'list';
    if (style === 2 || (style >= 20 && style < 30)) return 'slider';
    return 'none';
}

function isFatal(result: string | null): boolean {
    return result === null || (result.startsWith('ERR|') && result !== 'ERR|list_not_ready');
}

export class PauseMenu {

    public readonly pmx = new Pmx();
    public onWarning: ((active: boolean, kind: WarningKind | null) => void) | null = null;

    private enabled = false;
    private menuOpen = false;
    private tab: SettingsTab | null = null;
    private tick: number | null = null;
    private warningActive = false;
    private concealUntil = 0;
    private inKeymap = false;
    private capturing = false;
    private frontendLocked = false;
    private lastInputAt = 0;
    private queue: Promise<unknown> = Promise.resolve();
    private readonly textCache = new Map<string, CachedTexts>();
    private readonly simulatedUntil = new Map<number, number>();

    public get isOpen(): boolean {
        return this.menuOpen;
    }

    public get isCapturing(): boolean {
        return this.capturing;
    }

    public start(): void {
        this.enabled = true;
    }

    public stop(): void {
        this.enabled = false;
        if (!this.menuOpen) return;
        this.capturing = false;
        this.unlockFrontend();
        if (IsPauseMenuActive() && GetPauseMenuState() !== PM_SHUTTING_DOWN) SetFrontendActive(false);
    }

    public close(): Promise<void> {
        return this.run(() => this.closeMenu());
    }

    public simulatedInputs(): number[] {
        const frame = GetFrameCount();
        const inputs: number[] = [];
        for (const [input, until] of this.simulatedUntil) {
            if (frame <= until) inputs.push(input);
            else this.simulatedUntil.delete(input);
        }
        return inputs;
    }

    public exec<T>(task: (pmx: Pmx) => Promise<T>): Promise<T> {
        return this.run(async () => {
            await this.ensureOpen();
            return task(this.pmx);
        });
    }

    public state(): Promise<MenuState> {
        return this.exec(async pmx => parseMenuState(await pmx.call('GET_MENU_STATE')));
    }

    public press(input: number): Promise<void> {
        return this.run(async () => {
            await this.ensureOpen();
            await this.pressMenuInput(input);
        });
    }

    public loadTab(tab: SettingsTab): Promise<SettingsPage> {
        return this.run(async () => {
            if (this.inKeymap) await this.closeMenu();
            await this.ensureOpen();
            await this.enterTab(tab);
            await this.waitUntilAsync(async () => ((await this.pmx.callInt('GET_SETTINGS_COUNT')) ?? 0) > 0, 1500);
            return this.readPage();
        });
    }

    public refresh(): Promise<SettingsPage> {
        return this.run(async () => {
            await this.ensureTab();
            return this.readPage();
        });
    }

    public setPref(prefId: number, value: number): Promise<SettingsPage> {
        return this.run(async () => {
            await this.ensureTab();
            await this.changeAndWait(() => this.pmx.call('SET_PREF', [prefId, value]));
            return this.readPage();
        });
    }

    public stepPref(prefId: number, direction: number): Promise<SettingsPage> {
        return this.run(async () => {
            await this.ensureTab();
            await this.changeAndWait(() => this.withMenuInput(() => this.navigate('STEP_PREF', [prefId, direction < 0 ? -1 : 1])));
            return this.readPage();
        });
    }

    public triggerRow(row: number): Promise<SettingsPage> {
        return this.run(async () => {
            await this.ensureTab();
            await this.changeAndWait(() => this.navigate('TRIGGER_ROW', [row]));
            return this.readPage();
        });
    }

    public restoreDefaults(): Promise<SettingsPage> {
        return this.run(async () => {
            await this.ensureTab();
            const rows = await this.readRawRows();
            const index = rows.map(row => row?.kind).lastIndexOf('action');
            if (index === -1) throw new Error('no restore row');
            await this.changeAndWait(() => this.navigate('TRIGGER_ROW', [index]));
            return this.readPage();
        });
    }

    public applyGraphics(): Promise<SettingsPage> {
        return this.run(async () => {
            await this.ensureTab();
            await this.pressMenuInput(FrontendInput.X);
            return this.readPage();
        });
    }

    public discardGraphics(): Promise<SettingsPage> {
        return this.run(async () => {
            const tab = this.tab;
            await this.closeMenu();
            if (!tab) throw new Error('no tab to reopen');
            await this.ensureOpen();
            await this.enterTab(tab);
            return this.readPage();
        });
    }

    public isGraphicsDirty(): boolean {
        return this.menuOpen && !!PauseMenuIsContextActive(GetHashKey('GFX_Dirty'));
    }

    public async answerWarning(choice: WarningChoice): Promise<SettingsPage | KeymapPage> {
        if (IsWarningMessageActive()) {
            this.pressFrontend(WARNING_CHOICE_INPUTS[choice]);
            await this.waitUntil(() => !IsWarningMessageActive(), 500);
            await this.waitFrames(2);
        }
        return this.run(async () => {
            if (this.inKeymap) return this.readKeymap();
            await this.ensureTab();
            return this.readPage();
        });
    }

    public loadKeymap(category: number | null = null): Promise<KeymapPage> {
        return this.run(async () => {
            await this.ensureKeymap();
            if (category !== null) await this.enterKeymapCategory(category);
            return this.readKeymap();
        });
    }

    public beginRebind(row: number, slot: number): Promise<KeymapPage> {
        return this.run(async () => {
            await this.ensureKeymap();
            const result = await this.navigate('BEGIN_REBIND', [row, slot]);
            if (result !== 'OK') throw new Error(`BEGIN_REBIND: ${result}`);

            this.capturing = true;
            try {
                await this.waitUntilAsync(async () => (await this.keymapState()).capturing, 1000);
                const done = await this.waitUntilAsync(async () => IsWarningMessageActive() || !(await this.keymapState()).capturing, REBIND_TIMEOUT_MS);
                if (!done) await this.pressMenuInput(FrontendInput.Cancel);
            } finally {
                this.capturing = false;
            }
            await this.waitFrames(2);
            return this.readKeymap();
        });
    }

    public cancelRebind(): void {
        if (this.capturing) void this.pressMenuInput(FrontendInput.Cancel);
    }

    public clearKeymapSlot(row: number, slot: number): Promise<KeymapPage> {
        return this.run(async () => {
            await this.ensureKeymap();
            const result = await this.navigate('SELECT_KEYMAP_SLOT', [row, slot]);
            if (result !== 'OK') throw new Error(`SELECT_KEYMAP_SLOT: ${result}`);
            await this.waitFrames(1);
            await this.pressMenuInput(FrontendInput.Delete);
            const refreshed = await this.waitUntilAsync(async () => (await this.pmx.call('GET_KEYMAP_TEXT', [row, slot, 0])) === '', CLEAR_SLOT_REFRESH_MS);
            if (!refreshed) await this.reloadKeymapCategory();
            await this.waitFrames(1);
            return this.readKeymap();
        });
    }

    public restoreKeymapDefaults(): Promise<KeymapPage> {
        return this.run(async () => {
            await this.ensureKeymap();
            await this.navigateUntil('RESTORE_KEYMAP_DEFAULTS', [], ['TRIGGERED']);
            await this.waitFrames(2);
            return this.readKeymap();
        });
    }

    private run<T>(task: () => Promise<T>): Promise<T> {
        const next = this.queue.then(task, task);
        this.queue = next.catch(error => console.error(`[PauseMenu] ${error}`));
        return next;
    }

    private async ensureOpen(): Promise<void> {
        if (!this.enabled) throw new Error('pause menu driver stopped');
        if (this.menuOpen && IsPauseMenuActive()) return;

        if (IsPauseMenuActive() || GetPauseMenuState() !== 0) {
            SetFrontendActive(false);
            await this.waitUntil(() => GetPauseMenuState() === 0, 3000);
        }

        ActivateFrontendMenu(GetHashKey(LANDING_MENU), false, MENU_UNIQUE_ID_SETTINGS);
        this.menuOpen = true;
        this.tab = null;
        this.inKeymap = false;
        this.concealUntil = GetGameTimer() + CONCEAL_LOAD_MS;
        this.startTick();
        SetMouseCursorVisibleInMenus(false);

        try {
            const start = GetGameTimer();
            while ((await this.pmx.call('SET_STEALTH', [true])) !== 'OK') {
                if (GetGameTimer() - start > CONCEAL_LOAD_MS) throw new Error('pause menu did not load');
                await wait(0);
            }
            this.concealUntil = Math.min(this.concealUntil, GetGameTimer() + CONCEAL_AFTER_STEALTH_MS);
            if (!await this.waitUntil(() => GetPauseMenuState() === PM_READY && !!IsFrontendReadyForControl(), CONCEAL_LOAD_MS)) {
                throw new Error('pause menu did not load');
            }
        } finally {
            this.concealUntil = 0;
        }

        const start = GetGameTimer();
        while (GetGameTimer() - start < 2000) {
            if (parseMenuState(await this.pmx.call('GET_MENU_STATE')).level >= 1) {
                this.lockFrontend();
                this.lastInputAt = GetGameTimer();
                return;
            }
            await wait(0);
        }
        throw new Error('pause menu did not reach its category list');
    }

    private async ensureTab(): Promise<void> {
        if (!this.tab) throw new Error('no settings tab loaded');
        const tab = this.tab;
        await this.ensureOpen();
        await this.enterTab(tab);
    }

    private async enterTab(tab: SettingsTab): Promise<void> {
        const start = GetGameTimer();
        while (GetGameTimer() - start < 3000) {
            const result = await this.navigate('ENTER_TAB', [SETTINGS_TAB_MENU_IDS[tab]]);
            if (result === 'ALREADY') {
                this.tab = tab;
                return;
            }
            if (result === 'ENTERED') {
                this.tab = tab;
                await this.pmx.call('SET_STEALTH', [true]);
                return;
            }
            if (isFatal(result)) throw new Error(`ENTER_TAB ${tab}: ${result}`);
        }
        throw new Error(`ENTER_TAB ${tab}: timeout`);
    }

    private async changeAndWait(change: () => Promise<string | null>): Promise<void> {
        const before = await this.pmx.callInt('GET_SETTINGS_REVISION');
        const result = await change();
        if (!result || result.startsWith('ERR|')) {
            console.warn(`[PauseMenu] change refused: ${result}`);
            return;
        }
        await this.waitUntilAsync(async () => (await this.pmx.callInt('GET_SETTINGS_REVISION')) !== before, 1000);
        await this.waitFrames(1);
    }

    private async withMenuInput<T>(action: () => T | Promise<T>): Promise<T> {
        const remaining = this.lastInputAt + INPUT_THROTTLE_MS - GetGameTimer();
        if (remaining > 0) await wait(remaining);
        this.unlockFrontend();
        await this.waitFrames(1);
        const result = await action();
        this.lastInputAt = GetGameTimer();
        await this.waitFrames(SIMULATED_INPUT_FRAMES);
        if (this.menuOpen && IsPauseMenuActive()) this.lockFrontend();
        return result;
    }

    private async navigate(name: string, args: number[] = []): Promise<string | null> {
        const result = await this.pmx.navigate(name, args);
        this.lastInputAt = GetGameTimer();
        return result;
    }

    private pressMenuInput(input: number): Promise<void> {
        return this.withMenuInput(() => this.pressFrontend(input));
    }

    private pressFrontend(input: number): void {
        this.simulatedUntil.set(input, GetFrameCount() + SIMULATED_INPUT_FRAMES);
        EnableControlAction(FRONTEND_CONTROL, input, true);
        SetControlNormal(FRONTEND_CONTROL, input, 1.0);
    }

    private lockFrontend(): void {
        if (this.frontendLocked) return;
        TakeControlOfFrontend();
        this.frontendLocked = true;
    }

    private unlockFrontend(): void {
        if (!this.frontendLocked) return;
        ReleaseControlOfFrontend();
        this.frontendLocked = false;
    }

    private async navigateUntil(name: string, args: number[], done: string[]): Promise<string> {
        const start = GetGameTimer();
        while (GetGameTimer() - start < 3000) {
            const result = await this.navigate(name, args);
            if (result && done.includes(result)) return result;
            if (isFatal(result)) throw new Error(`${name}: ${result}`);
        }
        throw new Error(`${name}: timeout`);
    }

    private async keymapState(): Promise<KeymapState> {
        return parseKeymapState(await this.pmx.call('GET_KEYMAP_STATE'));
    }

    private async ensureKeymap(): Promise<void> {
        if (this.inKeymap && this.menuOpen && IsPauseMenuActive() && (await this.keymapState()).inKeymap) return;
        await this.ensureOpen();
        await this.navigateUntil('ENTER_KEYMAP', [], ['ENTERED', 'ALREADY']);
        if (!await this.waitUntilAsync(async () => (await this.keymapState()).inKeymap, 3000)) {
            throw new Error('key bindings page did not load');
        }
        this.inKeymap = true;
        this.tab = null;
        await this.pmx.call('SET_STEALTH', [true]);
    }

    private async enterKeymapCategory(index: number): Promise<void> {
        const state = await this.keymapState();
        if (state.menuLevel === 2 && state.categoryRow === index) return;
        await this.navigateUntil('ENTER_KEYMAP_CATEGORY', [index], ['ENTERED', 'ALREADY']);
    }

    private async reloadKeymapCategory(): Promise<void> {
        const state = await this.keymapState();
        const count = (await this.pmx.callInt('GET_KEYMAP_CATEGORY_COUNT')) ?? 0;
        if (state.menuLevel !== 2 || count < 3) return;

        const revision = await this.pmx.callInt('GET_SETTINGS_REVISION');
        await this.navigateUntil('SELECT_KEYMAP_CATEGORY', [state.categoryRow === 0 ? 1 : 0], ['OK']);
        await this.waitUntilAsync(async () => (await this.pmx.callInt('GET_SETTINGS_REVISION')) !== revision, 1000);
        await this.navigateUntil('ENTER_KEYMAP_CATEGORY', [state.categoryRow], ['ENTERED', 'ALREADY']);
    }

    private async readKeymap(): Promise<KeymapPage> {
        const state = await this.keymapState();

        const categoryCount = (await this.pmx.callInt('GET_KEYMAP_CATEGORY_COUNT')) ?? 0;
        const categoryIndexes = Array.from({ length: Math.max(0, categoryCount) }, (_, i) => i);
        const rawCategories = await this.pmx.batch(categoryIndexes.map(i => ({ name: 'GET_KEYMAP_CATEGORY', args: [i] })));
        const categoryLabels = await this.pmx.readChunks('GET_KEYMAP_CATEGORY_TEXT', categoryIndexes.map(i => [i]));
        const categories: KeymapCategory[] = categoryIndexes.map(i => {
            const [, alert, , kind] = (rawCategories[i] ?? '').split('|');
            return { index: i, label: stripMarkup(categoryLabels[i]), alert: alert === '1', kind: kind === 'restore' ? 'restore' : 'category' };
        });

        const rows: KeymapRow[] = [];
        if (state.menuLevel === 2) {
            const flags: string[] = [];
            let next = 0;
            for (;;) {
                const raw = await this.pmx.call('GET_KEYMAP_ROWS', [next]);
                if (!raw || raw.startsWith('ERR|')) break;
                const [, count, body] = raw.split('|');
                if (Number(count) === 0) break;
                flags.push(...body.split(';'));
                next += Number(count);
            }

            const indexes = flags.map((_, i) => i);
            const labels = await this.pmx.readChunks('GET_KEYMAP_TEXT', indexes.map(i => [i, -1]));
            const tokens = await this.pmx.readChunks('GET_KEYMAP_TEXT', indexes.flatMap(i => [[i, 0], [i, 1]]));
            const keys = await this.pmx.batch(indexes.flatMap(i => [
                { name: 'GET_KEYMAP_KEY', args: [i, 0] },
                { name: 'GET_KEYMAP_KEY', args: [i, 1] },
            ]));

            for (const i of indexes) {
                const [rowState, alert, mappable] = flags[i].split(',').map(Number);
                rows.push({
                    row: i,
                    label: stripMarkup(labels[i]),
                    state: rowState,
                    alert: alert === 1,
                    mappable: mappable === 1,
                    tokens: [tokens[i * 2], tokens[i * 2 + 1]],
                    slots: [
                        resolveBoundKey(keys[i * 2], tokens[i * 2], 0),
                        resolveBoundKey(keys[i * 2 + 1], tokens[i * 2 + 1], 1),
                    ],
                });
            }
        }

        return {
            tab: 'keymap',
            categories,
            category: state.menuLevel === 2 ? state.categoryRow : null,
            rows,
            capturing: state.capturing,
        };
    }

    private async readRawRows(): Promise<(RawRow | null)[]> {
        const count = await this.pmx.callInt('GET_SETTINGS_COUNT');
        if (count === null || count < 0) throw new Error(`GET_SETTINGS_COUNT: ${count}`);
        const raw = await this.pmx.batch(Array.from({ length: count }, (_, i) => ({ name: 'GET_SETTINGS_ROW', args: [i] })));
        return raw.map(row => (row && !row.startsWith('ERR|') ? parseRow(row) : null));
    }

    private async readPage(): Promise<SettingsPage> {
        const tab = this.tab!;
        const rawRows = await this.readRawRows();

        const requests: { row: number; part: number }[] = [];
        const keys = rawRows.map((raw, row) => (raw ? `${tab}|${row}|${raw.prefId}|${raw.style}|${raw.optionCount}` : ''));
        rawRows.forEach((raw, row) => {
            if (!raw || raw.kind === 'empty') return;
            const cached = this.textCache.has(keys[row]);
            if (!cached) requests.push({ row, part: -1 });
            if (controlOf(raw.style) !== 'list') return;
            if (raw.codeBuilt) requests.push({ row, part: 0 });
            else if (!cached) for (let part = 0; part < raw.optionCount; part++) requests.push({ row, part });
        });

        const texts = await this.pmx.readChunks('GET_SETTINGS_TEXT', requests.map(({ row, part }) => [row, part]));
        requests.forEach(({ row, part }, i) => {
            const entry = this.textCache.get(keys[row]) ?? { label: '', options: [] };
            if (part === -1) entry.label = texts[i];
            else entry.options[part] = texts[i];
            this.textCache.set(keys[row], entry);
        });

        const rows: SettingRow[] = [];
        rawRows.forEach((raw, row) => {
            if (!raw) return;
            const cached = this.textCache.get(keys[row]) ?? { label: '', options: [] };
            rows.push({
                row,
                prefId: raw.prefId,
                kind: raw.kind,
                control: raw.kind === 'pref' ? controlOf(raw.style) : 'none',
                value: raw.value,
                max: raw.max,
                active: raw.active,
                codeBuilt: raw.codeBuilt,
                label: cached.label,
                options: [...cached.options],
                textId: raw.kind === 'pref' ? PREF_TEXT_IDS[raw.prefId] ?? null : null,
            });
        });

        return {
            tab,
            rows,
            gfxDirty: !!PauseMenuIsContextActive(GetHashKey('GFX_Dirty')),
            videoMemory: GRAPHICS_TABS.has(tab) ? await this.readVideoMemory() : null,
        };
    }

    private async readVideoMemory(): Promise<VideoMemory | null> {
        const raw = await this.pmx.call('GET_VIDEO_MEMORY');
        if (!raw || raw.startsWith('ERR|')) return null;
        const [used, total, percent] = raw.split('|').map(Number);
        return used >= 0 && total > 0 ? { used, total, percent } : null;
    }

    private async closeMenu(): Promise<void> {
        if (!this.menuOpen) return;
        this.unlockFrontend();
        if (GetPauseMenuState() !== PM_SHUTTING_DOWN) SetFrontendActive(false);
        if (await this.waitUntil(() => !IsPauseMenuActive() && GetPauseMenuState() === 0, 2000)) this.markClosed();
    }

    private markClosed(): void {
        this.menuOpen = false;
        this.tab = null;
        this.inKeymap = false;
        this.capturing = false;
        this.unlockFrontend();
        this.stopTick();
        SetMouseCursorVisibleInMenus(true);
        SetMouseCursorVisible(false);
        if (this.warningActive) {
            this.warningActive = false;
            this.onWarning?.(false, null);
        }
    }

    private startTick(): void {
        if (this.tick !== null) return;
        this.tick = setTick(() => {
            if (GetGameTimer() < this.concealUntil) SuppressFrontendRenderingThisFrame();
            if (!IsPauseMenuActive() && GetPauseMenuState() === 0 && this.concealUntil === 0) {
                this.markClosed();
                return;
            }
            SetMouseCursorVisible(false);
            const warning = IsWarningMessageActive();
            if (warning !== this.warningActive) {
                this.warningActive = warning;
                const kind = warning ? WARNING_KINDS[GetWarningMessageTitleHash() >>> 0] ?? 'unknown' : null;
                this.onWarning?.(warning, kind);
            }
        });
    }

    private stopTick(): void {
        if (this.tick === null) return;
        clearTick(this.tick);
        this.tick = null;
    }

    private async waitFrames(count: number): Promise<void> {
        const target = GetFrameCount() + count;
        while (GetFrameCount() < target) await wait(0);
    }

    private async waitUntil(condition: () => boolean, timeoutMs: number): Promise<boolean> {
        const start = GetGameTimer();
        while (!condition()) {
            if (GetGameTimer() - start > timeoutMs) return false;
            await wait(0);
        }
        return true;
    }

    private async waitUntilAsync(condition: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
        const start = GetGameTimer();
        while (!(await condition())) {
            if (GetGameTimer() - start > timeoutMs) return false;
            await wait(0);
        }
        return true;
    }
}

export function suppressNativePauseMenu(menu: PauseMenu, onOpenAttempt?: () => void): () => void {
    let foreignActive = false;
    let postFxCleanupUntil = 0;

    const tick = setTick(() => {
        if (!menu.isOpen) {
            const state = GetPauseMenuState();
            const active = IsPauseMenuActive() || state !== 0;
            if (active) {
                SuppressFrontendRenderingThisFrame();
                if (state !== PM_SHUTTING_DOWN) SetFrontendActive(false);
                postFxCleanupUntil = GetGameTimer() + POSTFX_CLEANUP_MS;
            }
            if (GetGameTimer() < postFxCleanupUntil) {
                for (const effect of PAUSE_MENU_POSTFX) {
                    if (AnimpostfxIsRunning(effect)) AnimpostfxStop(effect);
                }
            }
            if (!active && foreignActive) SetMouseCursorVisible(false);
            if (active && !foreignActive) onOpenAttempt?.();
            foreignActive = active;
        }

        for (const pad of [PLAYER_CONTROL, FRONTEND_CONTROL]) {
            DisableControlAction(pad, FrontendInput.Pause, false);
            DisableControlAction(pad, FrontendInput.PauseAlternate, false);
        }
    });

    return () => clearTick(tick);
}
