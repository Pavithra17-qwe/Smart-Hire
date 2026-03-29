"use client";

import { useAuth, Role } from "@/hooks/use-auth";
import { SidebarProvider, Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { LayoutDashboard, Users, ClipboardList, History, LogOut, Briefcase, UserCog, Activity, FileText } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const roleNames: Record<Exclude<Role, null>, string> = {
  admin: "Administrator",
  agency: "Agency Partner",
  hr: "HR Team",
  panel: "Interviewer",
  interviewer: "Interviewer",
};

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { role, user, name } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/login?logout=success");
  };

  const navItems = React.useMemo(() => {
    const allItems = [
      { title: "Dashboard", icon: LayoutDashboard, href: `/${role}/dashboard`, roles: ["admin", "agency", "hr", "panel"] },
      { title: "User Management", icon: UserCog, href: "/admin/users", roles: ["admin"] },
      { title: "Job Requisitions", icon: Briefcase, href: "/admin/job-requisitions", roles: ["admin", "hr"] },
      { title: "Requirements", icon: FileText, href: "/agency/requirements", roles: ["agency"] },
      { title: "Candidate Evaluation", icon: ClipboardList, href: "/candidates/evaluation", roles: ["hr", "agency"] },
      { title: "Candidate List", icon: Users, href: "/candidates/list", roles: ["admin", "agency", "hr", "panel"] },
      { title: "Candidate History", icon: History, href: "/candidates/history", roles: ["admin", "agency", "hr", "panel"] },
      { title: "Activity Log", icon: Activity, href: "/admin/activity-log", roles: ["admin"] },
    ];
    return allItems.filter(item => item.roles.includes(role || ""));
  }, [role]);

  const headerContent = React.useMemo(() => {
    const config: Record<string, { title: string; subtitle: string }> = {
      "/admin/dashboard": { title: "Admin Dashboard", subtitle: "System-wide recruitment overview and analytics." },
      "/admin/users": { title: "User Management", subtitle: "Create, manage, and assign roles to users." },
      "/admin/job-requisitions": { title: "Job Requisitions", subtitle: "Manage your active hiring projects and JD requirements." },
      "/admin/agencies": { title: "Agency Management", subtitle: "Onboard and manage your recruitment partners." },
      "/admin/activity-log": { title: "Activity Log", subtitle: "Track all system-wide actions and updates." },
      "/agency/dashboard": { title: "Agency Dashboard", subtitle: "Your agency's recruitment performance summary." },
      "/agency/requirements": { title: "Requirements Management", subtitle: "Create and manage your own job requirements." },
      "/hr/dashboard": { title: "HR Dashboard", subtitle: "Manage candidate pipelines and interview workflows." },
      "/panel/dashboard": { title: "Panel Dashboard", subtitle: "View your assigned interviews and submit feedback." },
      "/candidates/evaluation": { title: "Candidate Evaluation", subtitle: "Initiate a new recruitment evaluation process." },
      "/candidates/list": { title: "Candidate List", subtitle: "A simplified list of all candidates in the pipeline." },
      "/candidates/history": { title: "Candidate History", subtitle: "Comprehensive log and workflow of all candidate evaluations." },
    };

    const isCandidateDetails = pathname.startsWith("/candidates/") && 
                               pathname !== "/candidates/evaluation" && 
                               pathname !== "/candidates/list" &&
                               pathname !== "/candidates/history";

    if (isCandidateDetails) {
      return { 
        title: "Candidate Details", 
        subtitle: "View and manage candidate profile information." 
      };
    }

    return config[pathname] || { title: "Dashboard", subtitle: "Welcome back to SmartHire." };
  }, [pathname]);

  const displayName = name || user?.email?.split('@')[0] || "User";
  const displayRole = role ? roleNames[role] : "User";

  const customHeaderPaths = ["/candidates/history", "/candidates/list", "/admin/job-requisitions", "/admin/agencies", "/admin/users", "/admin/activity-log", "/agency/requirements"];
  const showAutoHeader = !customHeaderPaths.includes(pathname);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border">
        <SidebarHeader className="p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="bg-primary rounded-lg p-2 flex-shrink-0">
              <Briefcase className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-headline font-bold text-lg group-data-[collapsible=icon]:hidden text-sidebar-foreground">SmartHire</span>
          </div>
        </SidebarHeader>
        <SidebarContent className="py-4">
          <SidebarMenu>
            {navItems.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton 
                  asChild 
                  isActive={pathname === item.href}
                  tooltip={item.title}
                  className="px-4 py-6"
                >
                  <Link href={item.href}>
                    <item.icon className={`w-5 h-5 ${pathname === item.href ? 'text-primary' : ''}`} />
                    <span className="font-medium">{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="p-4 border-t border-sidebar-border">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <SidebarMenuButton className="text-destructive hover:text-destructive hover:bg-destructive/10 px-4 py-6">
                <LogOut className="w-5 h-5" />
                <span className="font-medium">Log Out</span>
              </SidebarMenuButton>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure you want to log out?</AlertDialogTitle>
                <AlertDialogDescription>
                  You will need to sign in again to access your recruitment dashboard.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleLogout} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Log Out
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center justify-between px-6 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <SidebarTrigger className="-ml-1" />
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end mr-1">
              <span className="text-sm font-bold text-foreground leading-none">{displayName}</span>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-1">{displayRole}</span>
            </div>
            <Avatar className="h-10 w-10 border-2 border-primary/10">
              <AvatarFallback className="bg-primary/10 text-primary font-bold">
                {displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
        </header>

        {showAutoHeader && (
          <div className="px-6 pt-8 pb-4">
            <div className="flex flex-col">
              <h1 className="text-3xl font-headline font-bold text-foreground leading-tight tracking-tight">
                {headerContent.title}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {headerContent.subtitle}
              </p>
            </div>
          </div>
        )}

        <main className="flex-1 p-6 overflow-y-auto">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
