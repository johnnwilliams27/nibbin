/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@nibbin/creatures', '@nibbin/shared'],
  // CI gates typecheck and lint on every PR (npm run typecheck / lint / build),
  // so the deploy build must not re-run them — Vercel's production install omits
  // the root-level devDependencies (typescript, eslint, @types/node) that those
  // checks need, which otherwise fails the build. The deploy just compiles.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
