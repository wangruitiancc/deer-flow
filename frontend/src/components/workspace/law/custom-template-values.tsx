import { Input } from "@/components/ui/input";
import {
  type CustomTemplateVariables,
  type TemplateVariableErrors,
} from "@/core/law/custom-template-draft";

const fields = [
  {
    key: "title",
    label: "文书标题",
    hint: "替换 {{title}}，必填。",
    placeholder: "例如：合同审查意见",
  },
  {
    key: "project_label",
    label: "项目显示名称",
    hint: "替换 {{case}}，可填写案件或法律顾问主题，必填。",
    placeholder: "例如：年度法律顾问服务",
  },
  {
    key: "creation_date",
    label: "草稿创建日期",
    hint: "替换 {{date}}，未知留空，不代替开庭等事实日期。",
    placeholder: "YYYY-MM-DD",
  },
  {
    key: "creation_time",
    label: "草稿创建时间",
    hint: "替换 {{time}}，未知留空；未提供秒数时不补秒。",
    placeholder: "HH:MM 或 HH:MM:SS",
  },
] as const;

export function CustomTemplateValues({
  values,
  errors,
  disabled,
  onChange,
}: {
  values: CustomTemplateVariables;
  errors: TemplateVariableErrors;
  disabled: boolean;
  onChange: (values: CustomTemplateVariables) => void;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="mb-2 text-sm font-medium">起草显示值</legend>
      {fields.map(({ key, label, hint, placeholder }) => {
        const id = `custom-template-${key}`;
        return (
          <div key={key} className="space-y-1">
            <label htmlFor={id} className="text-sm font-medium">
              {label}
            </label>
            <Input
              id={id}
              value={values[key]}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
              aria-required={key === "title" || key === "project_label"}
              aria-invalid={Boolean(errors[key])}
              aria-describedby={`${id}-hint ${id}-error`}
              onChange={(event) =>
                onChange({ ...values, [key]: event.target.value })
              }
            />
            <p id={`${id}-hint`} className="text-muted-foreground text-xs">
              {hint}
            </p>
            <p
              id={`${id}-error`}
              role={errors[key] ? "alert" : undefined}
              className="text-destructive text-xs"
            >
              {errors[key]}
            </p>
          </div>
        );
      })}
    </fieldset>
  );
}
