import { useCallback } from 'react';
import { useStore } from '../data/store';
import { CollectionKey } from '../data/schema';
import { useToast } from './ui';

/** Smazání s nenápadnou možností „Vrátit“ v hlášce (a později v Koši v Nastavení). */
export function useRemoveWithUndo() {
  const { remove, restore } = useStore();
  const toast = useToast();
  return useCallback(
    (key: CollectionKey, id: string, message: string) => {
      remove(key, id);
      toast(message, { label: 'Vrátit', onClick: () => restore(key, id) });
    },
    [remove, restore, toast],
  );
}
