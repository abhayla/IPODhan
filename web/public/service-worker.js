/**
 * Service Worker Redirect
 *
 * This file redirects to sw.js for backwards compatibility.
 * Some browsers or tools may look for service-worker.js by default.
 */
importScripts('/sw.js');
