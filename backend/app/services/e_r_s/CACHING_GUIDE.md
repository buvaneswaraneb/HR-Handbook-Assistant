# EXAMPLE: How to use caching in your services

"""
Integration examples for the cache module
"""

from app.services.e_r_s.cache import cached, cache_clear, cache_set, cache_get

# ═══════════════════════════════════════════════════════════════
# OPTION 1: Use @cached decorator (Simplest)
# ═══════════════════════════════════════════════════════════════

# In employee_service.py, change:
#
#   def list_employees() -> list[dict]:
#       emp_repo, _ = _repos()
#       employees = emp_repo.get_all()
#       return [_enrich(e, emp_repo) for e in employees]
#
# To:
#
@cached(ttl_seconds=600, key_prefix="employees_list")
def list_employees() -> list[dict]:
    """Returns cached employee list for 10 minutes"""
    emp_repo, _ = _repos()
    employees = emp_repo.get_all()
    return [_enrich(e, emp_repo) for e in employees]


# ═══════════════════════════════════════════════════════════════
# OPTION 2: Manual cache management (More control)
# ═══════════════════════════════════════════════════════════════

from app.services.e_r_s.cache import get_cache

def get_employee(emp_id: str) -> dict:
    """Manually cached employee lookup"""
    cache = get_cache()
    cache_key = f"employee:{emp_id}"
    
    # Try cache first
    cached_emp = cache_get(cache_key)
    if cached_emp:
        return cached_emp
    
    # Cache miss — fetch from DB
    emp_repo, _ = _repos()
    emp = emp_repo.get_by_id(emp_id)
    if not emp:
        raise ValueError(f"Employee {emp_id} not found")
    
    result = _enrich(emp, emp_repo)
    cache_set(cache_key, result, ttl_seconds=600)  # 10 min TTL
    return result


# ═══════════════════════════════════════════════════════════════
# OPTION 3: Invalidate cache on updates (Essential!)
# ═══════════════════════════════════════════════════════════════

def create_employee(data):
    """Create employee and invalidate relevant caches"""
    emp_repo, _ = _repos()
    payload = data.model_dump(exclude_none=True, mode="json")
    skills = payload.pop("skills", [])
    emp = emp_repo.create(payload)
    
    # IMPORTANT: Invalidate caches that will be affected
    cache_clear("employees_list")  # Clears all entries starting with "employees_list"
    
    for skill in skills:
        add_skill(emp["id"], EmployeeSkillCreate(**skill))
    return _enrich(emp, emp_repo)


def update_employee(emp_id: str, data):
    """Update employee and invalidate caches"""
    emp_repo, _ = _repos()
    payload = data.model_dump(exclude_none=True, mode="json")
    emp = emp_repo.update(emp_id, payload) if payload else emp_repo.get_by_id(emp_id)
    
    # Invalidate caches
    cache_clear("employees_list")  # List is outdated
    cache_delete(f"employee:{emp_id}")  # This employee's cache is stale
    
    return _enrich(emp, emp_repo)


# ═══════════════════════════════════════════════════════════════
# RECOMMENDED CACHING STRATEGY FOR YOUR APP
# ═══════════════════════════════════════════════════════════════

"""
Service              TTL         Updated When
──────────────────────────────────────────────────────────────
list_employees       10-15 min   Any employee created/updated
get_employee         10 min      That employee updated
list_projects        10 min      Any project created/updated
list_leaves          5 min       Any leave created/deleted (frequent changes)
get_analytics        5-15 min    Rarely changes, set higher TTL
list_teams           15 min      Rarely changes
search_*             2 min       Ad-hoc queries, shorter TTL
"""

# ═══════════════════════════════════════════════════════════════
# QUICK REFERENCE: Cache Functions
# ═══════════════════════════════════════════════════════════════

"""
from app.services.e_r_s.cache import (
    cached,              # Decorator for functions
    cache_get,          # Get from cache
    cache_set,          # Set in cache
    cache_delete,       # Delete single entry
    cache_clear,        # Clear entries by pattern
    get_cache,          # Get cache instance for advanced usage
)

# Get cache stats
cache = get_cache()
stats = cache.stats()
# {'total_entries': 42, 'expired_entries': 3, 'active_entries': 39}
"""
