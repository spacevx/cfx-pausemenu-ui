const TAB_LABELS = {
    audio: 'Audio',
    display: 'Display',
    camera: 'Camera',
    controls: 'Controls',
    keyboard: 'Keyboard / mouse',
    graphics: 'Graphics',
    advgfx: 'Advanced graphics',
    voice: 'Voice chat',
};

const WARNING_TEXTS = {
    keepSettings: 'Keep these graphics settings?',
    restartRequired: 'The game must be restarted to apply these settings.',
    onlineWarning: 'This change may affect the online session. Continue?',
    keymapConflict: 'This key is already in use. Replace it?',
    keymapUnmappable: 'This key cannot be replaced.',
    keymapAutosave: 'An autosave of the key bindings exists. Load it?',
    keymapRestore: 'Reset all key bindings to their defaults?',
    keymapCantLeave: 'A key conflict prevents leaving this page.',
    keymapLeaveConflict: 'Some keys are in conflict. Leave anyway?',
    keymapLeaveUnmapped: 'Some controls have no key. Leave anyway?',
    unknown: 'The game is asking for a confirmation.',
};

const PAD_INPUTS = [
    ['Up', 188], ['Down', 187], ['Left', 189], ['Right', 190],
    ['Accept', 201], ['Back', 202], ['X', 203], ['Y', 204], ['LB', 205], ['RB', 206],
];

const app = document.getElementById('app');
const tabsNav = document.getElementById('tabs');
const content = document.getElementById('content');
const footer = document.getElementById('footer');
const statusText = document.getElementById('status');
const captureOverlay = document.getElementById('capture');
const warningOverlay = document.getElementById('warning');

let tabs = [];
let view = null;
let pending = 0;
let rawResult = '';

function el(tag, props = {}, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter(child => child !== null));
    return node;
}

function button(text, onClick, disabled = false, className = '') {
    return el('button', { type: 'button', textContent: text, onclick: onClick, disabled, className });
}

async function call(op, args = {}) {
    pending++;
    app.classList.add('busy');
    try {
        const response = await fetch(`https://${GetParentResourceName()}/pm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op, ...args }),
        });
        const body = await response.json();
        statusText.textContent = body.ok ? '' : body.error;
        return body.ok ? body.result : null;
    } catch (error) {
        statusText.textContent = String(error);
        return null;
    } finally {
        if (--pending === 0) app.classList.remove('busy');
    }
}

async function run(op, args = {}) {
    show(await call(op, args));
}

function show(result) {
    if (!result || typeof result !== 'object' || !Array.isArray(result.rows)) return;
    if (result.tab === 'keymap') renderKeymap(result);
    else renderSettings(result);
}

function buildNav() {
    tabsNav.replaceChildren(
        ...tabs.map(tab => button(TAB_LABELS[tab] ?? tab, () => select(tab), false, view === tab ? 'active' : '')),
        el('hr'),
        button('Key bindings', () => select('keymap'), false, view === 'keymap' ? 'active' : ''),
        button('Raw', () => select('raw'), false, view === 'raw' ? 'active' : ''),
    );
}

async function select(next) {
    view = next;
    buildNav();
    content.replaceChildren(el('p', { textContent: 'Loading…' }));
    footer.replaceChildren();
    if (next === 'raw') return renderRaw(await call('state'));
    if (next === 'keymap') return run('keymap', { category: 0 });
    return run('tab', { tab: next });
}

function settingRow(row) {
    if (row.kind === 'separator') return el('div', { className: 'separator' });
    if (row.kind === 'empty') return null;

    const off = row.active === 0;
    const node = el('div', { className: `row${off ? ' inactive' : ''}${row.active === 2 ? ' changed' : ''}` },
        el('span', { className: 'id', textContent: row.kind === 'pref' ? `#${row.prefId}` : '' }),
        el('span', { className: 'label', textContent: row.label }),
    );
    const step = direction => () => run('step', { prefId: row.prefId, direction });

    if (row.kind === 'action') {
        node.append(button('Run', () => run('trigger', { row: row.row }), off));
    } else if (row.kind === 'display') {
        node.append(el('span', { className: 'value', textContent: `${row.value} / ${row.max}` }));
    } else if (row.control === 'list') {
        const list = el('select', { disabled: off || row.codeBuilt });
        row.options.forEach((text, index) => list.append(el('option', { value: String(index), textContent: text })));
        list.value = String(row.codeBuilt ? 0 : row.value);
        list.onchange = () => run('set', { prefId: row.prefId, value: Number(list.value) });
        node.append(button('<', step(-1), off, 'step'), list, button('>', step(1), off, 'step'));
    } else if (row.control === 'slider') {
        const range = el('input', { type: 'range', min: '0', max: String(row.max), value: String(row.value), disabled: off });
        range.onchange = () => run('set', { prefId: row.prefId, value: Number(range.value) });
        node.append(button('<', step(-1), off, 'step'), range, button('>', step(1), off, 'step'), el('span', { className: 'value', textContent: `${row.value} / ${row.max}` }));
    }
    return node;
}

function renderSettings(page) {
    if (view !== page.tab) return;
    content.replaceChildren(...page.rows.map(settingRow).filter(Boolean));

    const items = [button('Refresh', () => run('refresh'))];
    if (page.rows.some(row => row.kind === 'action')) items.push(button('Restore defaults', () => run('defaults')));
    if (page.videoMemory) items.push(el('span', { textContent: `Video memory: ${page.videoMemory.used} / ${page.videoMemory.total} MB (${page.videoMemory.percent}%)` }));
    if (page.gfxDirty) {
        items.push(button('Apply', () => run('apply'), false, 'primary'), button('Discard changes', () => run('discard')));
    }
    footer.replaceChildren(...items);
}

function slotButtons(row, slot) {
    const key = row.slots[slot];
    const bound = row.tokens[slot] !== '';
    const text = key.text ?? (bound ? '[key]' : '—');
    return [
        button(text, () => run('rebind', { row: row.row, slot }), !row.mappable, 'slot'),
        button('x', () => run('clear', { row: row.row, slot }), !row.mappable || !bound),
    ];
}

function renderKeymap(page) {
    if (view !== 'keymap') return;
    const categories = el('div', { className: 'categories' }, ...page.categories.map(category => category.kind === 'restore'
        ? button(category.label, () => run('restoreKeys'))
        : button(`${category.label}${category.alert ? ' (!)' : ''}`, () => run('keymap', { category: category.index }), false, category.index === page.category ? 'active' : '')));

    const keys = el('div', { className: 'keys' }, ...page.rows.map(row => el('div', { className: 'row' },
        el('span', { className: `label${row.alert ? ' alert' : ''}`, textContent: row.label }),
        ...slotButtons(row, 0),
        ...slotButtons(row, 1),
    )));

    content.replaceChildren(el('div', { className: 'columns' }, categories, keys));
    footer.replaceChildren(el('span', { textContent: 'Click a key to rebind it, x to clear it.' }));
}

function parseArg(text) {
    const value = text.trim();
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value !== '' && !Number.isNaN(Number(value)) ? Number(value) : value;
}

function renderRaw(menuState) {
    if (view !== 'raw') return;
    const name = el('input', { type: 'text', value: 'GET_MENU_STATE', size: 28 });
    const args = el('input', { type: 'text', placeholder: 'comma separated arguments', size: 34 });
    const send = async () => {
        const list = args.value.trim() === '' ? [] : args.value.split(',').map(parseArg);
        rawResult = JSON.stringify(await call('raw', { name: name.value.trim(), args: list }));
        renderRaw(await call('state'));
    };

    content.replaceChildren(
        el('h3', { textContent: 'Menu state' }),
        el('pre', { textContent: menuState ? JSON.stringify(menuState, null, 2) : '—' }),
        el('h3', { textContent: 'Simulated inputs' }),
        el('div', { className: 'pad' }, ...PAD_INPUTS.map(([label, input]) => button(label, async () => renderRaw(await call('press', { input }))))),
        el('h3', { textContent: 'Scaleform call' }),
        el('div', { className: 'pad' }, name, args, button('Call', send, false, 'primary')),
        el('pre', { textContent: rawResult || '—' }),
    );
    footer.replaceChildren(button('Refresh', async () => renderRaw(await call('state'))));
}

function showWarning({ active, kind }) {
    warningOverlay.hidden = !active;
    if (!active) return;
    document.getElementById('warning-text').textContent = WARNING_TEXTS[kind] ?? WARNING_TEXTS.unknown;
    const answer = choice => async () => show(await call('answer', { choice }));
    const buttons = [button('Yes', answer('yes'), false, 'primary'), button('No', answer('no'))];
    if (kind === 'keymapAutosave' || kind === 'unknown') buttons.push(button('Other', answer('alt')));
    document.getElementById('warning-buttons').replaceChildren(...buttons);
}

function hide() {
    app.hidden = true;
    captureOverlay.hidden = true;
    warningOverlay.hidden = true;
    view = null;
}

window.addEventListener('message', ({ data }) => {
    if (data.type === 'open') {
        tabs = data.data.tabs;
        app.hidden = false;
        select(tabs[0]);
    } else if (data.type === 'close') {
        hide();
    } else if (data.type === 'capturing') {
        captureOverlay.hidden = !data.data;
    } else if (data.type === 'warning') {
        showWarning(data.data);
    }
});

window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || app.hidden || !captureOverlay.hidden || !warningOverlay.hidden) return;
    call('close');
});

document.getElementById('close').onclick = () => call('close');
