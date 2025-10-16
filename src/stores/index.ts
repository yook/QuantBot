import { createPinia } from 'pinia'

export const pinia = createPinia()

// HMR handling for stores
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('Pinia stores reloaded via HMR');
  });
}
