describe('API health', () => {
    it('skips when API_BASE_URL is not set', function () {
        if (!process.env.API_BASE_URL) {
            this.skip();
        }
    });
});
