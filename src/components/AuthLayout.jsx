import React from "react";

/** @param {{ title: string, subtitle?: string, footer?: React.ReactNode, children?: React.ReactNode, icon?: React.ComponentType<any> }} props */
export default function AuthLayout({ title, subtitle, footer, children }) {
  return (
    <div className="min-h-dvh flex flex-col bg-secondary/50 px-4 py-6 sm:px-8">
      <header className="flex shrink-0 items-center justify-start">
            <div role="img" aria-label="Empaco" className="inline-flex items-center justify-center gap-1.5 text-primary">
              <svg aria-hidden="true" viewBox="35 43 80 80" className="h-7 w-7 shrink-0">
                <circle cx="75" cy="83" r="37" fill="none" stroke="currentColor" strokeWidth="2.5" />
                <text x="55" y="106" fill="currentColor" fontFamily="Georgia,serif" fontStyle="italic" fontSize="73">e</text>
              </svg>
              <span aria-hidden="true" className="text-[40px] leading-[48px] tracking-[-2px]" style={{fontFamily:"Georgia,serif"}}>empaco<span className="text-[#93ad51]">.</span></span>
            </div>
      </header>
      <div className="flex flex-1 items-center justify-center py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-6 sm:mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
        </div>
        <div className="bg-card rounded-2xl shadow-sm border border-border p-5 sm:p-8">
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}
      </div>
      </div>
    </div>
  );
}
