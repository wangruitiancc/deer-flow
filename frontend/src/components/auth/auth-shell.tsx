"use client";

import { useEffect, useState, type ReactNode } from "react";

import { MatrixLawLogo } from "@/components/brand/matrix-law-logo";
import { cn } from "@/lib/utils";

export interface AuthStep {
  label: string;
}

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  steps?: AuthStep[];
  activeStep?: number;
  footer?: ReactNode;
  contentClassName?: string;
}

function CurrentDate() {
  const [label, setLabel] = useState("");

  useEffect(() => {
    const parts = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    }).formatToParts(new Date());
    const value = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    setLabel(`${value.year}年${value.month}月${value.day}日  ${value.weekday}`);
  }, []);

  return <span className="min-h-5">{label}</span>;
}

function ProgressSteps({
  steps,
  activeStep,
}: {
  steps: AuthStep[];
  activeStep: number;
}) {
  return (
    <ol className="mt-8 flex items-start" aria-label="注册进度">
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const active = stepNumber === activeStep;
        const complete = stepNumber < activeStep;
        return (
          <li
            key={step.label}
            className="flex min-w-0 flex-1 items-start last:flex-none"
          >
            <div className="flex w-20 shrink-0 flex-col items-center gap-2">
              <span
                className={cn(
                  "flex size-11 items-center justify-center rounded-full border text-lg",
                  active || complete
                    ? "border-[#175342] bg-[#175342] text-white"
                    : "border-[#aeb4b4] bg-transparent text-[#697174]",
                )}
                aria-current={active ? "step" : undefined}
              >
                {stepNumber}
              </span>
              <span
                className={cn(
                  "text-sm whitespace-nowrap",
                  active ? "font-semibold text-[#182125]" : "text-[#687075]",
                )}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <span
                className={cn(
                  "mt-[22px] h-px min-w-8 flex-1",
                  complete ? "bg-[#175342]" : "bg-[#b9bdbc]",
                )}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function AuthShell({
  title,
  subtitle,
  children,
  steps,
  activeStep = 1,
  footer,
  contentClassName,
}: AuthShellProps) {
  return (
    <main className="min-h-screen bg-[#f7f5ef] text-[#182125] lg:grid lg:grid-cols-[38.5%_61.5%]">
      <aside className="flex min-h-[230px] flex-col justify-between bg-[#153f34] px-8 py-8 text-white sm:px-12 lg:min-h-screen lg:px-[13.5%] lg:pt-14 lg:pb-6">
        <div aria-hidden="true" />
        <div className="lg:translate-y-6">
          <MatrixLawLogo
            className="flex items-center gap-3 font-serif text-4xl tracking-[-0.02em] sm:text-5xl lg:text-[3.25rem]"
            markSize={42}
          />
          <p className="mt-1 text-xl tracking-[0.18em] text-white/90">
            法律智能工作台
          </p>
          <span className="mt-7 block h-[3px] w-12 bg-[#70b59c]" />
          <p className="mt-8 text-lg tracking-[0.08em] text-white/76">
            专业，让法律工作更高效。
          </p>
        </div>
        <div className="hidden space-y-2 text-sm tracking-[0.08em] text-white/62 lg:block">
          <p>Matrix-Law</p>
          <p className="tracking-normal">
            每个租户独立记账，每位律师独立承担 LLM 用量。
          </p>
        </div>
      </aside>

      <section className="flex min-h-[calc(100vh-230px)] flex-col px-5 py-6 sm:px-10 lg:min-h-screen lg:px-[13.5%] lg:py-7">
        <div className="ml-auto hidden text-right text-sm leading-7 text-[#62696c] sm:block">
          <p>
            <CurrentDate />
          </p>
          <p className="tracking-[0.18em]">合规 · 安全 · 稳定 · 持续</p>
        </div>

        <div
          className={cn(
            "my-auto w-full max-w-[650px] py-10 lg:translate-y-[15px] lg:py-14",
            contentClassName,
          )}
        >
          <header>
            <h1 className="font-serif text-[2rem] leading-tight tracking-[-0.025em] text-[#10181c] sm:text-[3rem]">
              {title}
            </h1>
            <p className="mt-2 text-base leading-7 text-[#60696e] sm:text-lg">
              {subtitle}
            </p>
          </header>

          {steps && steps.length > 0 && (
            <ProgressSteps steps={steps} activeStep={activeStep} />
          )}

          <div className="mt-9 lg:mt-[50px]">{children}</div>
          {footer && <div className="mt-9 lg:mt-12">{footer}</div>}
        </div>
      </section>
    </main>
  );
}

export const authFieldClassName =
  "h-14 rounded-md border-[#bcc1c0] bg-white/35 px-4 text-base shadow-none placeholder:text-[#9a9fa1] focus-visible:border-[#1c6652] focus-visible:ring-[#1c6652]/15";

export const authPrimaryButtonClassName =
  "h-14 w-full rounded-md bg-[#15523f] text-base text-white shadow-none hover:bg-[#123f32] lg:h-16";
