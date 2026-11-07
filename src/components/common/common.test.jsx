import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FormField from './FormField.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import Button from './Button.jsx';
import Tabs from './Tabs.jsx';

describe('FormField', () => {
  it('labels the control and links the hint', () => {
    render(<FormField label="Email" name="email" hint="Tu correo" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAccessibleDescription('Tu correo');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks errors as invalid and describes them', () => {
    render(<FormField label="Email" name="email" hint="Tu correo" error="Email inválido" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Email inválido');
  });
});

describe('Button', () => {
  it('disables itself and announces busy state while loading', () => {
    render(
      <Button loading loadingText="Enviando…">
        Enviar
      </Button>
    );
    const btn = screen.getByRole('button', { name: 'Enviando…' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Tabs', () => {
  it('exposes the selected option with aria-pressed', async () => {
    const onChange = vi.fn();
    const items = [
      { key: 'all', label: 'Todas' },
      { key: 'sell', label: 'Comprar' },
    ];
    render(<Tabs items={items} value="all" onChange={onChange} label="Tipo" />);
    expect(screen.getByRole('group', { name: 'Tipo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Comprar' }));
    expect(onChange).toHaveBeenCalledWith('sell');
  });
});

describe('ErrorBoundary', () => {
  function Boom({ message }) {
    throw new Error(message);
  }

  it('renders a fallback instead of a blank screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom message="kaput" />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Algo salió mal');
    expect(screen.getByRole('alert')).not.toHaveTextContent('kaput'); // sin detalles internos
  });

  it('suggests reloading when a lazy chunk fails after a deploy', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom message="Failed to fetch dynamically imported module: /assets/Trade-x.js" />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('nueva versión');
  });

  it('recovers when resetKey changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Boom message="x" />
      </ErrorBoundary>
    );
    rerender(
      <ErrorBoundary resetKey="/b">
        <p>ok now</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('ok now')).toBeInTheDocument();
  });
});
