"use client";

import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { UserCheck } from "lucide-react";

export default function HRDashboard() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col">
        <h1 className="text-3xl font-headline font-bold text-foreground leading-tight tracking-tight">HR Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage candidate pipelines and interview workflows.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Welcome, HR Team!</CardTitle>
          <CardDescription>This is your dedicated dashboard to streamline recruitment.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 p-8 bg-muted/30 rounded-lg justify-center">
            <UserCheck className="w-12 h-12 text-primary" />
            <p className="text-lg font-medium text-muted-foreground">HR-specific components and features will be displayed here.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
