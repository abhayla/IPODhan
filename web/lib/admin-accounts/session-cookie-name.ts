/**
 * The admin session cookie's name, in a module with no Node-only imports so the Edge middleware
 * can share it with the session code (session-token.ts re-exports it).
 */
export const ADMIN_SESSION_COOKIE = 'ipodhan_admin_session';
