// Every localStorage key the app writes. One origin serves every book, so
// what belongs to a book (progress, where it was left, its offline copy) is
// namespaced by the book id; look-and-feel preferences are shared.
// index.html reads THEME and PAGE_INVERT before first paint by their literal
// strings — change them there too.

const NS = "murrnglish";

export const THEME_KEY = `${NS}.theme`;
export const PAGE_INVERT_KEY = `${NS}.page-invert`;
export const SIDEBAR_COLLAPSED_KEY = `${NS}.sidebar-collapsed`;
/** id of the book last worked in: where a bare "/" resumes */
export const LAST_BOOK_KEY = `${NS}.last-book`;

export const progressKey = (book: string) => `${NS}.${book}.progress-v1`;
/** last opened page of the book ("u13"/"a41") */
export const lastRouteKey = (book: string) => `${NS}.${book}.last-route-v1`;
/** written after a successful offline download: {"ts": <epoch-ms>} */
export const offlineKey = (book: string) => `${NS}.${book}.offline-v1`;
/** set when the offline copy is removed by hand (offline.ts) */
export const offlineRemovedKey = (book: string) => `${NS}.${book}.offline-v1-removed`;
