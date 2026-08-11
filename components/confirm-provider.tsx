"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ConfirmAction {
  id: string;
  label: string;
  variant?: "default" | "destructive" | "ghost";
}

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Rendered left-to-right in the footer. Cancel is always added last. */
  actions: ConfirmAction[];
  cancelLabel?: string;
}

/**
 * Resolves with the chosen action's id, or `null` if the dialog was dismissed
 * (Cancel, Esc, or clicking away).
 *
 * Distinguishing "dismissed" from "chose something" is the point: a native
 * confirm can only say yes or no, which forced the layout-template prompt to
 * overload Cancel as "add alongside" — leaving no way to actually back out.
 */
type ConfirmFn = (options: ConfirmOptions) => Promise<string | null>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: string | null) => void) | null>(null);

  const settle = useCallback((value: string | null) => {
    // Clear the resolver before resolving so a caller that immediately opens
    // another dialog can't have its resolver overwritten by this one.
    const resolve = resolver.current;
    resolver.current = null;
    setOptions(null);
    resolve?.(value);
  }, []);

  const confirm = useCallback<ConfirmFn>(
    (next) => {
      // If something is already open, abandon it rather than stranding a
      // promise that would never settle.
      resolver.current?.(null);
      setOptions(next);
      return new Promise<string | null>((resolve) => {
        resolver.current = resolve;
      });
    },
    []
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={options !== null}
        onOpenChange={(open) => {
          if (!open) settle(null);
        }}
      >
        {options && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{options.title}</AlertDialogTitle>
              {options.description && (
                <AlertDialogDescription>{options.description}</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              {/*
                Using the Radix primitives rather than bare buttons so the
                dialog gets its default focus on Cancel and Esc maps to it.
                They also close the dialog themselves, which fires
                onOpenChange -> settle(null); that lands after settle(id) has
                already cleared the resolver, so it's a harmless no-op.
              */}
              <AlertDialogCancel onClick={() => settle(null)}>
                {options.cancelLabel ?? "Cancel"}
              </AlertDialogCancel>
              {options.actions.map((action) => (
                <AlertDialogAction
                  key={action.id}
                  variant={action.variant ?? "default"}
                  onClick={() => settle(action.id)}
                >
                  {action.label}
                </AlertDialogAction>
              ))}
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
