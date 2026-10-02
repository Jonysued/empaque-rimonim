import React from "react";
import empacoLogo from "@/empaco-logo.svg";

/** @param {{ title: string, subtitle?: string, footer?: React.ReactNode, children?: React.ReactNode, icon?: React.ComponentType<any> }} props */
export default function AuthLayout({ title, subtitle, footer, children }) {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-secondary/50 px-4 py-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6 sm:mb-10">
          <div className="mb-8 flex flex-col items-center gap-3">
            <img src={empacoLogo} alt="Empaco" className="w-full max-w-[240px] h-auto rounded-lg" />
          <p className="text-xs tracking-wide text-primary">Tecnología y trazabilidad</p>
          </div>
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
  );
}
