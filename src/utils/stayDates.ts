// Hotel stays are calendar dates in Taiwan, independent of the server timezone.
export function parseStayDate(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:T00:00:00\.000Z)?$/.exec(value);
    if (!match) return null;
    const [, y, m, d] = match.map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
        return null;
    return date.toISOString().slice(0, 10);
}
export function todayInTaipei(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}
