export default {
  "/api": {
    target: `http://localhost:${process.env.PORT ?? 3000}`,
    changeOrigin: true,
  },
};
