import React from "react";
import rimonimLogo from "@/rimonim-logo.svg";

/** @param {{ title: string, subtitle?: string, footer?: React.ReactNode, children?: React.ReactNode, icon?: React.ComponentType<any> }} props */
export default function AuthLayout({ title, subtitle, footer, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="mb-8 flex justify-center">
            <img src={rimonimLogo} alt="Rimonim" className="w-full max-w-[280px] h-auto rounded-lg" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
        </div>
        <div className="bg-card rounded-2xl shadow-sm border border-border p-8">
          {children}
        </div>
        {footer && (
          <p className="text-center text-sm text-muted-foreground mt-6">{footer}</p>
        )}
      </div>
    </div>
  );
}
