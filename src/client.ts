import { KeymapPage, MenuState, PauseMenu, SettingsPage, suppressNativePauseMenu, WarningChoice } from './pause_menu';
import { PmxArg } from './pmx';
import { SETTINGS_TABS, SettingsTab } from './prefs';

interface Request {
    op: string;
    tab?: SettingsTab;
    prefId?: number;
    value?: number;
    direction?: number;
    row?: number;
    slot?: number;
    category?: number | null;
    choice?: WarningChoice;
    input?: number;
    name?: string;
    args?: PmxArg[];
}

type Result = SettingsPage | KeymapPage | MenuState | string | boolean | null;
type Reply = (response: { ok: true; result: Result } | { ok: false; error: string }) => void;

const menu = new PauseMenu();
let open = false;
let capturing = false;
let stopSuppress: (() => void) | null = null;

function send(type: string, data: unknown): void {
    SendNuiMessage(JSON.stringify({ type, data }));
}

function applyFocus(): void {
    if (!open) {
        SetNuiFocus(false, false);
        SetNuiFocusKeepInput(false);
    } else if (capturing) {
        SetNuiFocus(true, false);
        SetNuiFocusKeepInput(true);
    } else {
        SetNuiFocus(true, true);
        SetNuiFocusKeepInput(false);
    }
}

function openUi(): void {
    if (open) return;
    open = true;
    menu.start();
    stopSuppress = suppressNativePauseMenu(menu);
    applyFocus();
    send('open', { tabs: SETTINGS_TABS });
}

function closeUi(): void {
    if (!open) return;
    open = false;
    capturing = false;
    menu.stop();
    stopSuppress?.();
    stopSuppress = null;
    applyFocus();
    send('close', null);
}

async function rebind(row: number, slot: number): Promise<KeymapPage> {
    capturing = true;
    applyFocus();
    send('capturing', true);
    try {
        return await menu.beginRebind(row, slot);
    } finally {
        capturing = false;
        applyFocus();
        send('capturing', false);
    }
}

async function handle(request: Request): Promise<Result> {
    switch (request.op) {
        case 'tab': return menu.loadTab(request.tab ?? 'audio');
        case 'refresh': return menu.refresh();
        case 'set': return menu.setPref(request.prefId ?? -1, request.value ?? 0);
        case 'step': return menu.stepPref(request.prefId ?? -1, request.direction ?? 1);
        case 'trigger': return menu.triggerRow(request.row ?? -1);
        case 'defaults': return menu.restoreDefaults();
        case 'apply': return menu.applyGraphics();
        case 'discard': return menu.discardGraphics();
        case 'keymap': return menu.loadKeymap(request.category ?? null);
        case 'rebind': return rebind(request.row ?? -1, request.slot ?? 0);
        case 'cancelRebind': menu.cancelRebind(); return true;
        case 'clear': return menu.clearKeymapSlot(request.row ?? -1, request.slot ?? 0);
        case 'restoreKeys': return menu.restoreKeymapDefaults();
        case 'answer': return menu.answerWarning(request.choice ?? 'no');
        case 'state': return menu.state();
        case 'press': await menu.press(request.input ?? -1); return menu.state();
        case 'raw': return menu.exec(pmx => pmx.call(request.name ?? '', request.args ?? []));
        case 'close': closeUi(); return true;
        default: throw new Error(`unknown op ${request.op}`);
    }
}

menu.onWarning = (active, kind) => send('warning', { active, kind });

RegisterNuiCallbackType('pm');
on('__cfx_nui:pm', async (request: Request, reply: Reply) => {
    try {
        reply({ ok: true, result: await handle(request) });
    } catch (error) {
        reply({ ok: false, error: `${error}` });
    }
});

RegisterCommand('pmui', () => (open ? closeUi() : openUi()), false);
RegisterKeyMapping('pmui', 'Pause menu example', 'keyboard', 'F6');

on('onResourceStop', (resource: string) => {
    if (resource === GetCurrentResourceName()) closeUi();
});
