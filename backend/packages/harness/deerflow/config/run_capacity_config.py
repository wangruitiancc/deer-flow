"""Admission capacity for top-level Agent runs."""

from pydantic import BaseModel, Field, model_validator


class RunCapacityConfig(BaseModel):
    """Fail-fast active-run limits captured by ``RunManager`` at startup."""

    max_active_global: int = Field(default=0, ge=0, le=100_000)
    max_active_per_tenant: int = Field(default=0, ge=0, le=100_000)
    max_active_per_user: int = Field(default=0, ge=0, le=10_000)
    retry_after_seconds: int = Field(default=5, ge=1, le=3600)

    @model_validator(mode="after")
    def _validate_limit_relationship(self) -> "RunCapacityConfig":
        if self.max_active_global and self.max_active_per_user > self.max_active_global:
            raise ValueError("max_active_per_user cannot exceed max_active_global when both limits are enabled")
        if self.max_active_global and self.max_active_per_tenant > self.max_active_global:
            raise ValueError("max_active_per_tenant cannot exceed max_active_global when both limits are enabled")
        return self
