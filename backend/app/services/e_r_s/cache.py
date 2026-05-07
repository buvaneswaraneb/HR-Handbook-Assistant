"""
Temporary In-Memory Cache for Reducing Database Queries
Supports TTL-based expiration and manual invalidation
"""

from __future__ import annotations
import time
from typing import Any, Callable, Optional
from functools import wraps
from threading import Lock


class CacheEntry:
    """Single cache entry with TTL support"""
    def __init__(self, value: Any, ttl_seconds: int = 300):
        self.value = value
        self.created_at = time.time()
        self.ttl_seconds = ttl_seconds

    def is_expired(self) -> bool:
        """Check if cache entry has expired"""
        return time.time() - self.created_at > self.ttl_seconds

    def __repr__(self):
        age = time.time() - self.created_at
        return f"<CacheEntry age={age:.1f}s ttl={self.ttl_seconds}s>"


class SimpleCache:
    """Thread-safe in-memory cache with TTL support"""
    
    def __init__(self):
        self._cache: dict[str, CacheEntry] = {}
        self._lock = Lock()

    def get(self, key: str) -> Optional[Any]:
        """Get value from cache if not expired"""
        with self._lock:
            if key not in self._cache:
                return None
            
            entry = self._cache[key]
            if entry.is_expired():
                del self._cache[key]
                return None
            
            return entry.value

    def set(self, key: str, value: Any, ttl_seconds: int = 300):
        """Store value in cache with TTL"""
        with self._lock:
            self._cache[key] = CacheEntry(value, ttl_seconds)

    def delete(self, key: str):
        """Remove specific cache entry"""
        with self._lock:
            self._cache.pop(key, None)

    def clear(self):
        """Clear all cache entries"""
        with self._lock:
            self._cache.clear()

    def delete_pattern(self, pattern: str):
        """Delete all entries matching pattern (prefix-based)"""
        with self._lock:
            keys_to_delete = [k for k in self._cache.keys() if k.startswith(pattern)]
            for k in keys_to_delete:
                del self._cache[k]

    def stats(self) -> dict:
        """Get cache statistics"""
        with self._lock:
            expired = sum(1 for e in self._cache.values() if e.is_expired())
            return {
                "total_entries": len(self._cache),
                "expired_entries": expired,
                "active_entries": len(self._cache) - expired,
            }


# Global cache instance
_cache = SimpleCache()


def get_cache() -> SimpleCache:
    """Get global cache instance"""
    return _cache


def cached(ttl_seconds: int = 300, key_prefix: str = ""):
    """
    Decorator to cache function results with TTL
    
    Usage:
        @cached(ttl_seconds=600, key_prefix="employees")
        def list_employees():
            return expensive_db_query()
    
    Args:
        ttl_seconds: Time to live in seconds
        key_prefix: Optional prefix for cache key (auto-generated from function name if empty)
    """
    def decorator(func: Callable) -> Callable:
        prefix = key_prefix or func.__name__
        
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Generate cache key from function name and arguments
            args_str = "|".join(str(a) for a in args)
            kwargs_str = "|".join(f"{k}={v}" for k, v in sorted(kwargs.items()))
            cache_key = f"{prefix}:{args_str}:{kwargs_str}".strip(":")
            
            # Try to get from cache
            cached_value = _cache.get(cache_key)
            if cached_value is not None:
                return cached_value
            
            # Cache miss — call function
            result = func(*args, **kwargs)
            
            # Store in cache
            _cache.set(cache_key, result, ttl_seconds)
            return result
        
        return wrapper
    
    return decorator


# Convenience functions for common operations
def cache_get(key: str) -> Optional[Any]:
    """Get value from cache"""
    return _cache.get(key)


def cache_set(key: str, value: Any, ttl_seconds: int = 300):
    """Set value in cache"""
    _cache.set(key, value, ttl_seconds)


def cache_delete(key: str):
    """Delete specific cache entry"""
    _cache.delete(key)


def cache_clear(pattern: Optional[str] = None):
    """Clear cache entries matching pattern or all if no pattern"""
    if pattern:
        _cache.delete_pattern(pattern)
    else:
        _cache.clear()
