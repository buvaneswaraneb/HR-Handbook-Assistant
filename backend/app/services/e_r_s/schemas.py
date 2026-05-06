from __future__ import annotations
from datetime import date, time, datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field, condecimal


# ── Skills ────────────────────────────────────────────────────────────────────
class SkillCreate(BaseModel):
    name: str
    category: Optional[str] = None


class SkillOut(BaseModel):
    id: UUID
    name: str
    category: Optional[str] = None


class EmployeeSkillCreate(BaseModel):
    skill_name: str                        # resolved to skill_id in service
    skill_level: int = Field(..., ge=1, le=5)
    experience_years_with_skill: Optional[float] = None
    notes: Optional[str] = None


class EmployeeSkillUpdate(BaseModel):
    skill_level: Optional[int] = Field(None, ge=1, le=5)
    experience_years_with_skill: Optional[float] = None
    notes: Optional[str] = None


class EmployeeSkillOut(BaseModel):
    skill_id: UUID
    skill_name: str
    skill_level: int
    experience_years_with_skill: Optional[float] = None
    notes: Optional[str] = None


# ── Experience ────────────────────────────────────────────────────────────────
class ExperienceCreate(BaseModel):
    company_name: str
    job_title: str
    start_date: date
    end_date: Optional[date] = None
    description: Optional[str] = None


class ExperienceOut(BaseModel):
    id: UUID
    company_name: str
    job_title: str
    start_date: date
    end_date: Optional[date] = None
    description: Optional[str] = None


# ── Employee ──────────────────────────────────────────────────────────────────
class EmployeeCreate(BaseModel):
    name: str
    email: EmailStr
    role: str
    team: Optional[str] = None
    manager_id: Optional[UUID] = None
    linkedin_url: Optional[str] = None
    rating: Optional[float] = Field(None, ge=0, le=5)
    total_experience_years: Optional[float] = None
    availability: bool = True
    project_joined_date: Optional[date] = None
    project_end_date: Optional[date] = None
    work_start_time: Optional[time] = None
    work_end_time: Optional[time] = None


class EmployeeUpdate(EmployeeCreate):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = None


class AvailabilityUpdate(BaseModel):
    availability: bool


class EmployeeOut(BaseModel):
    id: UUID
    name: str
    email: str
    role: str
    team: Optional[str] = None
    manager_id: Optional[UUID] = None
    linkedin_url: Optional[str] = None
    rating: Optional[float] = None
    total_experience_years: Optional[float] = None
    availability: bool
    project_joined_date: Optional[date] = None
    project_end_date: Optional[date] = None
    work_start_time: Optional[time] = None
    work_end_time: Optional[time] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    skills: List[EmployeeSkillOut] = []
    experience: List[ExperienceOut] = []
    projects: List[ProjectBriefOut] = []


# ── Projects ──────────────────────────────────────────────────────────────────
class ProjectBriefOut(BaseModel):
    project_id: UUID
    project_name: str
    role_in_project: str


class ProjectCreate(BaseModel):
    project_name: str
    client_name: Optional[str] = None
    client_email: Optional[EmailStr] = None
    project_description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    percent_complete: Optional[int] = Field(None, ge=0, le=100)
    status: Optional[str] = "active"


class ProjectOut(BaseModel):
    id: UUID
    project_name: str
    client_name: Optional[str] = None
    client_email: Optional[str] = None
    project_description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    percent_complete: Optional[int] = 0
    status: Optional[str] = "active"
    days_remaining: Optional[int] = None   # computed, not stored
    created_at: Optional[datetime] = None
    team: List[AssignmentOut] = []


class AssignmentCreate(BaseModel):
    employee_id: UUID
    role_in_project: str


class AssignmentOut(BaseModel):
    employee_id: UUID
    employee_name: str
    role_in_project: str
    assigned_date: Optional[date] = None


# ── Bulk upload ───────────────────────────────────────────────────────────────
class BulkEmployeeItem(EmployeeCreate):
    skills: List[EmployeeSkillCreate] = []
    experience: List[ExperienceCreate] = []


class BulkUploadResult(BaseModel):
    success: List[str] = []
    failed: List[dict] = []


# ── Search ────────────────────────────────────────────────────────────────────
class SearchParams(BaseModel):
    team: Optional[str] = None
    role: Optional[str] = None
    skill: Optional[str] = None
    availability: Optional[bool] = None
    min_rating: Optional[float] = Field(None, ge=0, le=5)


# ── Analytics ────────────────────────────────────────────────────────────────
class SkillCoverageItem(BaseModel):
    skill_name: str
    required: int
    actual: int


class AnalyticsSummary(BaseModel):
    total_employees: int
    active_projects: int
    on_leave: int
    available: int
    skill_coverage: List[SkillCoverageItem]


# ── Activity Feed ─────────────────────────────────────────────────────────────
class ActivityOut(BaseModel):
    id: UUID
    event_type: str
    department: Optional[str] = None
    actor_id: Optional[UUID] = None
    entity_type: Optional[str] = None
    entity_id: Optional[UUID] = None
    title: str
    description: Optional[str] = None
    metadata: Optional[dict] = {}
    created_at: Optional[datetime] = None


class ActivityCreate(BaseModel):
    event_type: str
    department: Optional[str] = None
    actor_id: Optional[UUID] = None
    entity_type: Optional[str] = None
    entity_id: Optional[UUID] = None
    title: str
    description: Optional[str] = None
    metadata: Optional[dict] = {}


# ── Files ─────────────────────────────────────────────────────────────────────
class FileOut(BaseModel):
    id: UUID
    filename: str
    storage_path: str
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None
    project_id: Optional[UUID] = None
    department: Optional[str] = None
    uploaded_by: Optional[UUID] = None
    description: Optional[str] = None
    created_at: Optional[datetime] = None


class FileLinkRequest(BaseModel):
    project_id: Optional[UUID] = None
    department: Optional[str] = None
    description: Optional[str] = None


EmployeeOut.model_rebuild()
