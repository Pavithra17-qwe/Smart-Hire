"use client";

import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Star } from "lucide-react";

export default function PanelDashboard() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col">
        <h1 className="text-3xl font-headline font-bold text-foreground leading-tight tracking-tight">Interviewer Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">View your assigned interviews and submit feedback.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Welcome, Interviewer!</CardTitle>
          <CardDescription>This is your space for managing interview feedback.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 p-8 bg-muted/30 rounded-lg justify-center">
            <Star className="w-12 h-12 text-primary" />
            <p className="text-lg font-medium text-muted-foreground">Assigned interviews and feedback forms will be displayed here.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
