"use client";

import { Plus } from "lucide-react";
import Button from "../ui/Button";
import { useAddApplication } from "@/hooks/useAddApplication";

interface NavButtonProps {
  onClick?: () => void;
}

export default function NavButton({ onClick }: NavButtonProps) {
  const addApplication = useAddApplication();

  return (
    <Button
      variant="primary"
      onClick={() => {
        onClick?.();
        addApplication();
      }}
    >
      <Plus size={16} /> Add application
    </Button>
  );
}
