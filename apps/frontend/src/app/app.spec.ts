import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';

@Component({ template: '<p>halaman uji</p>' })
class RoutedPage {}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Network Registry');
  });

  it('exposes exactly one main landmark', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelectorAll('main, [role="main"]')).toHaveLength(1);
  });

  // Spec 0008: shell tetap merender <router-outlet />, jadi halaman fitur muncul di dalam App.
  describe('with routes', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [provideRouter([{ path: 'uji', component: RoutedPage }])],
      });
    });

    it('renders the page of the active route', async () => {
      const fixture = TestBed.createComponent(App);

      await TestBed.inject(Router).navigateByUrl('/uji');
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('halaman uji');
    });
  });
});
