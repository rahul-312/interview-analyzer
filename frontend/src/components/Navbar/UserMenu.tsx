"use client";

import { LogOut } from "lucide-react";
import Button from "../ui/Button";
import { useAuth } from "@/context/AuthContext";

export default function UserMenu() {
  const { user, logout } = useAuth();

  return (
    <div className="flex items-center gap-2xl">
      <span className="text-sm text-medium-gray">{user?.first_name || user?.username}</span>
      <Button onClick={logout} className="flex items-center gap-sm text-sm text-medium-gray hover:text-ink">
        <LogOut size={16} /> Log out
      </Button>
    </div>
  );
}
