import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ROUTES } from '@angular/router';
import { appConfig } from './app.config';
import { routes } from './app.routes';

describe('appConfig', () => {
  it('registers the app routes with the router', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });

    expect(TestBed.inject(ROUTES, null)).toEqual([routes]);
  });

  describe('global error listeners', () => {
    const handleError = vi.fn();

    beforeEach(() => {
      handleError.mockClear();
      TestBed.configureTestingModule({
        // Matikan rethrow bawaan TestBed supaya error sampai ke ErrorHandler aplikasi.
        rethrowApplicationErrors: false,
        providers: [...appConfig.providers, { provide: ErrorHandler, useValue: { handleError } }],
      });
      TestBed.inject(ErrorHandler);
    });

    it('forwards an uncaught window error to the ErrorHandler', () => {
      const error = new Error('boom');

      window.dispatchEvent(new ErrorEvent('error', { error, cancelable: true }));

      expect(handleError).toHaveBeenCalledWith(error);
    });
  });
});
