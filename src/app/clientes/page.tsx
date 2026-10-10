"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { upsertCustomer } from "@/lib/ops";
import { notifyOutboxChanged } from "@/lib/sync/engine";
import { formatARS } from "@/lib/money";
import { useUI } from "@/stores/ui";
import { PageHeader } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { MoneyInput, parseMoney } from "@/components/ui/MoneyInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";

export default function ClientesPage() {
  const showToast = useUI((s) => s.showToast);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [limitRaw, setLimitRaw] = useState("");

  const customers = useLiveQuery(() => db.customers.orderBy("name").toArray(), []);
  const movements = useLiveQuery(
    () => db.account_movements.orderBy("moved_at").toArray(),
    []
  );

  const info = useMemo(() => {
    const map = new Map<string, { balance: number; lastAt: string | null }>();
    for (const m of movements ?? []) {
      // saldo = suma de movimientos (un pago que llegó tarde no lo deja corrido)
      const prev = map.get(m.customer_id);
      map.set(m.customer_id, {
        balance: (prev?.balance ?? 0) + m.amount,
        lastAt: m.moved_at,
      });
    }
    return map;
  }, [movements]);

  const active = (customers ?? []).filter((c) => c.is_active);

  return (
    <>
      <PageHeader
        title="Clientes"
        action={
          <Button size="md" onClick={() => setCreating(true)}>
            <Plus size={16} /> Nuevo
          </Button>
        }
      />
      <div className="flex flex-col gap-3 p-4">
        {customers === undefined ? (
          <div aria-busy />
        ) : active.length === 0 ? (
          <EmptyState
            title="Todavía no hay clientes cargados"
            description="Los clientes permiten vender a cuenta corriente y llevar el saldo de cada uno con su historial completo."
            action={<Button onClick={() => setCreating(true)}>Cargar el primero</Button>}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((c) => {
              const i = info.get(c.id);
              const balance = i?.balance ?? 0;
              const overLimit = c.credit_limit != null && balance > c.credit_limit;
              return (
                <li key={c.id}>
                  <Link
                    href={`/clientes/${c.id}`}
                    className="flex items-center justify-between gap-2 rounded-2xl border border-[var(--border-soft)] bg-surface-card px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink-950">{c.name}</p>
                      <p className="text-xs text-ink-500">
                        {c.credit_limit != null
                          ? `Límite ${formatARS(c.credit_limit)}`
                          : "Sin límite definido"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {overLimit ? <Badge tone="danger">Superó límite</Badge> : null}
                      {balance > 0 && !overLimit ? (
                        <Badge tone="warn">Debe</Badge>
                      ) : null}
                      {balance <= 0 ? <Badge tone="ok">Al día</Badge> : null}
                      <span className="tnum text-base font-bold text-ink-950">
                        {formatARS(balance)}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Sheet open={creating} onOpenChange={setCreating} title="Nuevo cliente">
        <div className="flex flex-col gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre"
            aria-label="Nombre"
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Teléfono (opcional)"
            aria-label="Teléfono"
            inputMode="tel"
            className="h-12 w-full rounded-xl border border-[var(--border-strong)] bg-surface-elevated px-3 text-sm outline-none focus:border-brand-700"
          />
          <MoneyInput
            label="Límite de crédito (opcional)"
            value={limitRaw}
            onChange={setLimitRaw}
            hint="Al superarlo se avisa, pero no se bloquea la venta."
          />
          <Button
            size="lg"
            disabled={!name.trim()}
            onClick={async () => {
              await upsertCustomer({
                name: name.trim(),
                phone: phone.trim() || undefined,
                credit_limit: limitRaw ? parseMoney(limitRaw) : null,
              });
              notifyOutboxChanged();
              showToast(`Cliente guardado: ${name.trim()}`);
              setName("");
              setPhone("");
              setLimitRaw("");
              setCreating(false);
            }}
          >
            Guardar cliente
          </Button>
        </div>
      </Sheet>
    </>
  );
}
