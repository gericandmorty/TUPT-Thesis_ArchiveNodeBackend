const { Redis } = require('@upstash/redis');

// Initialize Redis only if environment variables are provided,
// allowing graceful fallback if Redis is not configured.
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
} else {
    console.warn("Upstash Redis environment variables are missing. Caching will be disabled.");
}

/**
 * Gets the current global version timestamp for thesis searches.
 * If not set, it generates one and stores it.
 * This is used as a namespace for cache keys to allow constant-time invalidation.
 */
async function getSearchCacheVersion() {
    if (!redis) return null;
    try {
        let version = await redis.get('thesis_search_version');
        if (!version) {
            version = Date.now().toString();
            // Cache version doesn't strictly need an expiry, but 7 days is safe
            await redis.set('thesis_search_version', version, { ex: 604800 });
        }
        return version;
    } catch (error) {
        console.error("Redis getSearchCacheVersion error:", error);
        return null;
    }
}

/**
 * Invalidates all thesis search caches by simply bumping the global version timestamp.
 * Any old cache keys using the previous timestamp will be ignored and naturally expire.
 */
async function invalidateSearchCache() {
    if (!redis) return;
    try {
        const newVersion = Date.now().toString();
        await redis.set('thesis_search_version', newVersion, { ex: 604800 });
        console.log(`Cache invalidated. New search version: ${newVersion}`);
    } catch (error) {
        console.error("Redis invalidateSearchCache error:", error);
    }
}

module.exports = {
    redis,
    getSearchCacheVersion,
    invalidateSearchCache
};
