import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus';

interface TestEvents {
  ping: { n: number };
  other: { s: string };
}

describe('EventBus', () => {
  it('entrega o payload aos handlers subscritos', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.on('ping', handler);
    bus.emit('ping', { n: 1 });
    expect(handler).toHaveBeenCalledWith({ n: 1 });
  });

  it('não entrega eventos de outro nome', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.on('other', handler);
    bus.emit('ping', { n: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('a função devolvida por on() cancela a subscrição', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const off = bus.on('ping', handler);
    off();
    bus.emit('ping', { n: 1 });
    expect(handler).not.toHaveBeenCalled();
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('off() remove um handler específico', () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('ping', a);
    bus.on('ping', b);
    bus.off('ping', a);
    bus.emit('ping', { n: 2 });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('once() só dispara na primeira emissão', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.once('ping', handler);
    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ n: 1 });
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('once() pode ser cancelado antes de disparar', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const off = bus.once('ping', handler);
    off();
    bus.emit('ping', { n: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('cancelar durante a emissão não salta os restantes handlers', () => {
    const bus = new EventBus<TestEvents>();
    const calls: string[] = [];
    const offA = bus.on('ping', () => {
      calls.push('a');
      offA();
    });
    bus.on('ping', () => calls.push('b'));
    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });
    expect(calls).toEqual(['a', 'b', 'b']);
  });

  it('handlers adicionados durante a emissão só recebem a emissão seguinte', () => {
    const bus = new EventBus<TestEvents>();
    const late = vi.fn();
    bus.once('ping', () => bus.on('ping', late));
    bus.emit('ping', { n: 1 });
    expect(late).not.toHaveBeenCalled();
    bus.emit('ping', { n: 2 });
    expect(late).toHaveBeenCalledWith({ n: 2 });
  });

  it('o mesmo handler subscrito duas vezes só é chamado uma vez', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.on('ping', handler);
    bus.on('ping', handler);
    bus.emit('ping', { n: 1 });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('clear() remove handlers de um evento ou de todos', () => {
    const bus = new EventBus<TestEvents>();
    bus.on('ping', vi.fn());
    bus.on('other', vi.fn());
    bus.clear('ping');
    expect(bus.listenerCount('ping')).toBe(0);
    expect(bus.listenerCount('other')).toBe(1);
    bus.clear();
    expect(bus.listenerCount('other')).toBe(0);
  });
});
