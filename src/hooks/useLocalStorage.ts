import { useState, useCallback, useEffect, useRef } from "react";

export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  options?: {
    serialize?: (value: T) => string;
    deserialize?: (value: string) => T;
  }
) {
  const serialize = options?.serialize || JSON.stringify;
  const deserialize = options?.deserialize || JSON.parse;

  const [state, setState] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      if (item === null) return defaultValue;
      return deserialize(item);
    } catch {
      return defaultValue;
    }
  });

  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const setValue = useCallback(
    (value: T | ((prevState: T) => T)) => {
      try {
        const valueToStore = value instanceof Function ? value(stateRef.current) : value;
        stateRef.current = valueToStore;
        setState(valueToStore);
        localStorage.setItem(key, serialize(valueToStore));
      } catch (error) {
        console.error(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, serialize]
  );

  const remove = useCallback(() => {
    try {
      localStorage.removeItem(key);
      stateRef.current = defaultValue;
      setState(defaultValue);
    } catch (error) {
      console.error(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, defaultValue]);

  return [state, setValue, remove] as const;
}
