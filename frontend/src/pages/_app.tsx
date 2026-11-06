import React from 'react';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import MainLayout from '@/components/MainLayout';
import { AuthProvider } from '@/context/AuthContext';
import '@/styles/globals.css';

const MyApp: React.FC<AppProps> = ({ Component, pageProps }) => {
  return (
    <>
      <Head>
        <title>Interview Analyzer</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta
          name="description"
          content="Track job applications, debrief interviews, and turn your weak spots into a prep plan."
        />
        <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/assets/favicon/favicon-192.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/assets/favicon/apple-touch-icon.png" />
      </Head>

      <AuthProvider>
        <MainLayout>
          <Component {...pageProps} />
        </MainLayout>
      </AuthProvider>
    </>
  );
};

export default MyApp;
