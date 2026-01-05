import { NextRequest } from 'next/server';
import { proxyRequest } from '@/lib/proxy';

type Props = {
    params: Promise<{ path?: string[] }>;
};

export async function GET(
    request: NextRequest,
    { params }: Props
) {
    const resolvedParams = await params;
    const pathArr = resolvedParams.path || [];
    const path = pathArr.join('/');
    const searchParams = request.nextUrl.searchParams.toString();
    const host = request.headers.get('host') || 'localhost:3000';

    return proxyRequest(path, searchParams, request.headers, host);
}

export async function POST(
    request: NextRequest,
    { params }: Props
) {
    const resolvedParams = await params;
    const pathArr = resolvedParams.path || [];
    const path = pathArr.join('/');
    const searchParams = request.nextUrl.searchParams.toString();
    const host = request.headers.get('host') || 'localhost:3000';

    return proxyRequest(path, searchParams, request.headers, host);
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
