const MAX_PENDING_RETURNS = 20;
const RETURN_TIMEOUT_MS = 1000;
const TEXT_CHUNK_FULL_BYTES = 57;

export type PmxArg = number | boolean | string;

export interface PmxCall {
    name: string;
    args?: PmxArg[];
    header?: boolean;
}

export const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export function isPmxError(result: string | null): boolean {
    return result === null || result.startsWith('ERR|');
}

function utf8Length(text: string): number {
    let bytes = 0;
    for (const char of text) {
        const code = char.codePointAt(0)!;
        bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
    return bytes;
}

function begin({ name, args, header }: PmxCall): boolean {
    const started = header ? BeginScaleformMovieMethodOnFrontendHeader(name) : BeginScaleformMovieMethodOnFrontend(name);
    if (!started) return false;
    for (const arg of args ?? []) {
        if (typeof arg === 'boolean') ScaleformMovieMethodAddParamBool(arg);
        else if (typeof arg === 'string') ScaleformMovieMethodAddParamTextureNameString(arg);
        else if (Number.isInteger(arg)) ScaleformMovieMethodAddParamInt(arg);
        else ScaleformMovieMethodAddParamFloat(arg);
    }
    return true;
}

export class Pmx {

    private lastNavigationFrame = -1;

    public send(name: string, args: PmxArg[] = [], header = false): boolean {
        if (!begin({ name, args, header })) return false;
        EndScaleformMovieMethod();
        return true;
    }

    public async call(name: string, args: PmxArg[] = [], header = false): Promise<string | null> {
        const [result] = await this.batch([{ name, args, header }]);
        return result;
    }

    public async callInt(name: string, args: PmxArg[] = [], header = false): Promise<number | null> {
        const [result] = await this.batch([{ name, args, header }], 'int');
        return result;
    }

    public async navigate(name: string, args: PmxArg[] = []): Promise<string | null> {
        while (GetFrameCount() === this.lastNavigationFrame) await wait(0);
        this.lastNavigationFrame = GetFrameCount();
        return this.call(name, args);
    }

    public async batch(calls: PmxCall[], ret: 'string'): Promise<(string | null)[]>;
    public async batch(calls: PmxCall[], ret: 'int'): Promise<(number | null)[]>;
    public async batch(calls: PmxCall[]): Promise<(string | null)[]>;
    public async batch(calls: PmxCall[], ret: 'string' | 'int' = 'string'): Promise<(string | number | null)[]> {
        const results: (string | number | null)[] = [];
        for (let offset = 0; offset < calls.length; offset += MAX_PENDING_RETURNS) {
            const handles = calls.slice(offset, offset + MAX_PENDING_RETURNS).map(call => (begin(call) ? EndScaleformMovieMethodReturnValue() : null));

            const start = GetGameTimer();
            while (handles.some(handle => handle !== null && !IsScaleformMovieMethodReturnValueReady(handle)) && GetGameTimer() - start < RETURN_TIMEOUT_MS) {
                await wait(0);
            }

            for (const handle of handles) {
                if (handle === null || !IsScaleformMovieMethodReturnValueReady(handle)) results.push(null);
                else results.push(ret === 'int' ? GetScaleformMovieMethodReturnValueInt(handle) : GetScaleformMovieMethodReturnValueString(handle));
            }
        }
        return results;
    }

    public async readChunks(name: string, argLists: number[][]): Promise<string[]> {
        const texts = argLists.map(() => '');
        let pending = argLists.map((_, index) => index);

        while (pending.length > 0) {
            const chunks = await this.batch(pending.map(index => ({
                name,
                args: [...argLists[index], texts[index].length],
            })));

            const next: number[] = [];
            chunks.forEach((chunk, i) => {
                if (!chunk || chunk.startsWith('ERR|')) return;
                const index = pending[i];
                texts[index] += chunk;
                if (utf8Length(chunk) >= TEXT_CHUNK_FULL_BYTES) next.push(index);
            });
            pending = next;
        }
        return texts;
    }
}
