import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from './browserDownload';

describe('downloadBlob', () => {
  const createObjectURL = vi.fn(() => 'blob:test-download');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it('clicks a hidden download link and removes all temporary resources', () => {
    let clickedLink: HTMLAnchorElement | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      clickedLink = document.querySelector('a[download]');
      expect(document.body).toContainElement(clickedLink);
    });
    const blob = new Blob(['catalog'], { type: 'text/csv' });

    downloadBlob(blob, 'grundschutz.csv');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickedLink).toMatchObject({
      download: 'grundschutz.csv',
      href: 'blob:test-download',
    });
    expect(clickedLink).not.toBeNull();
    expect(document.body).not.toContainElement(clickedLink);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-download');
  });

  it('removes the link and revokes the object URL when clicking fails', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('Browser rejected download');
    });

    expect(() => downloadBlob(new Blob(['catalog']), 'grundschutz.csv')).toThrow(
      'Browser rejected download',
    );

    expect(document.body).toBeEmptyDOMElement();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-download');
  });

  it('revokes the object URL when link creation fails', () => {
    vi.spyOn(document, 'createElement').mockImplementationOnce(() => {
      throw new Error('Browser rejected link creation');
    });

    expect(() => downloadBlob(new Blob(['catalog']), 'grundschutz.csv')).toThrow(
      'Browser rejected link creation',
    );

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-download');
  });
});
