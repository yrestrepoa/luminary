import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Sin `globals: true`, Testing Library no desmonta solo entre tests.
afterEach(() => cleanup());
