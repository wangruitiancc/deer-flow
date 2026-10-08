from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ToolSideEffect(StrEnum):
    """Where a tool may mutate state outside the agent message stream."""

    READ_ONLY = "read_only"
    LOCAL_WRITE = "local_write"
    EXTERNAL_WRITE = "external_write"


class ToolReplayPolicy(StrEnum):
    """Whether an existing checkpoint tool call may execute again."""

    SAFE = "safe"
    KEYED = "keyed"
    FORBID = "forbid"


class ToolGroupConfig(BaseModel):
    """Config section for a tool group"""

    name: str = Field(..., description="Unique name for the tool group")
    model_config = ConfigDict(extra="allow")


class ToolConfig(BaseModel):
    """Config section for a tool"""

    name: str = Field(..., description="Unique name for the tool")
    group: str = Field(..., description="Group name for the tool")
    use: str = Field(
        ...,
        description="Variable name of the tool provider(e.g. deerflow.sandbox.tools:bash_tool)",
    )
    side_effect: ToolSideEffect = Field(
        default=ToolSideEffect.EXTERNAL_WRITE,
        description=("Side-effect class. Defaults to external_write so an undeclared custom or dynamically supplied tool is never assumed replay-safe."),
    )
    replay_policy: ToolReplayPolicy = Field(
        default=ToolReplayPolicy.FORBID,
        description=("Checkpoint replay policy: safe, keyed (requires the configured idempotency-key argument on every call), or forbid."),
    )
    idempotency_key_arg: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z_][A-Za-z0-9_.-]*$",
        description="Tool argument carrying the stable idempotency key when replay_policy=keyed.",
    )
    model_config = ConfigDict(extra="allow")

    @model_validator(mode="after")
    def _validate_execution_policy(self) -> "ToolConfig":
        if self.replay_policy is ToolReplayPolicy.KEYED:
            if self.idempotency_key_arg is None:
                raise ValueError("idempotency_key_arg is required when replay_policy=keyed")
            if self.side_effect is ToolSideEffect.READ_ONLY:
                raise ValueError("replay_policy=keyed is not valid for a read_only tool")
        elif self.idempotency_key_arg is not None:
            raise ValueError("idempotency_key_arg is only valid when replay_policy=keyed")
        return self
