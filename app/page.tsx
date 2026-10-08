import { MedicineApp } from "@/components/medicine-app";

export default function Home() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return <MedicineApp mode={configured ? "supabase" : "demo"} />;
}
