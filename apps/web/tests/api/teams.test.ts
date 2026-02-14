import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockAuth = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserFindFirst = vi.fn();
const mockUserUpdate = vi.fn();
const mockUserUpdateMany = vi.fn();
const mockTeamFindUnique = vi.fn();
const mockTeamCreate = vi.fn();
const mockTeamUpdate = vi.fn();
const mockTeamDelete = vi.fn();
const mockSubscriptionFindUnique = vi.fn();
const mockTeamInviteFindUnique = vi.fn();
const mockTeamInviteFindFirst = vi.fn();
const mockTeamInviteFindMany = vi.fn();
const mockTeamInviteCreate = vi.fn();
const mockTeamInviteUpdate = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      findFirst: (...args: unknown[]) => mockUserFindFirst(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
      updateMany: (...args: unknown[]) => mockUserUpdateMany(...args),
    },
    team: {
      findUnique: (...args: unknown[]) => mockTeamFindUnique(...args),
      create: (...args: unknown[]) => mockTeamCreate(...args),
      update: (...args: unknown[]) => mockTeamUpdate(...args),
      delete: (...args: unknown[]) => mockTeamDelete(...args),
    },
    subscription: {
      findUnique: (...args: unknown[]) => mockSubscriptionFindUnique(...args),
    },
    teamInvite: {
      findUnique: (...args: unknown[]) => mockTeamInviteFindUnique(...args),
      findFirst: (...args: unknown[]) => mockTeamInviteFindFirst(...args),
      findMany: (...args: unknown[]) => mockTeamInviteFindMany(...args),
      create: (...args: unknown[]) => mockTeamInviteCreate(...args),
      update: (...args: unknown[]) => mockTeamInviteUpdate(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { GET as getTeams, POST as createTeam } from '@/app/api/teams/route';
import {
  GET as getTeam,
  PATCH as updateTeam,
  DELETE as deleteTeam,
} from '@/app/api/teams/[teamId]/route';
import { GET as getMembers, DELETE as removeMember } from '@/app/api/teams/[teamId]/members/route';
import {
  GET as getInvites,
  POST as createInvite,
  DELETE as revokeInvite,
} from '@/app/api/teams/[teamId]/invite/route';
import {
  GET as getInviteDetails,
  POST as acceptInvite,
} from '@/app/api/teams/invite/[token]/route';

function createRequest(url: string, options: { body?: Record<string, unknown> } = {}): NextRequest {
  const request = new NextRequest(url, {
    method: options.body ? 'POST' : 'GET',
    ...(options.body && {
      body: JSON.stringify(options.body),
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  return request;
}

function createRouteParams<T>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

const mockSession = {
  user: { id: 'user-1', email: 'owner@example.com', name: 'Owner' },
};

const mockTeam = {
  id: 'team-1',
  name: 'Engineering Team',
  ownerId: 'user-1',
  seats: 5,
  createdAt: new Date('2025-01-15T10:00:00Z'),
  updatedAt: new Date('2025-01-15T10:00:00Z'),
  owner: { id: 'user-1', name: 'Owner', email: 'owner@example.com', image: null },
  members: [
    { id: 'user-1', name: 'Owner', email: 'owner@example.com', image: null, createdAt: new Date() },
    {
      id: 'user-2',
      name: 'Member',
      email: 'member@example.com',
      image: null,
      createdAt: new Date(),
    },
  ],
  invites: [],
  _count: { members: 2 },
};

const mockInvite = {
  id: 'invite-1',
  teamId: 'team-1',
  email: 'newuser@example.com',
  token: 'abc123token',
  status: 'PENDING',
  invitedBy: 'user-1',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  createdAt: new Date(),
  team: {
    id: 'team-1',
    name: 'Engineering Team',
    seats: 5,
    _count: { members: 2 },
  },
};

describe('GET /api/teams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const response = await getTeams();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Unauthorized');
  });

  it('returns null team when user has no team', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockUserFindUnique.mockResolvedValue({ id: 'user-1', teamId: null });

    const response = await getTeams();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ team: null });
  });

  it('returns team with members and invites when user is in a team', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockUserFindUnique.mockResolvedValue({ id: 'user-1', teamId: 'team-1' });
    mockTeamFindUnique.mockResolvedValue(mockTeam);

    const response = await getTeams();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.team).toHaveProperty('id', 'team-1');
    expect(body.team).toHaveProperty('name', 'Engineering Team');
    expect(body.team.members).toHaveLength(2);
  });
});

describe('POST /api/teams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams', {
      body: { name: 'New Team' },
    });
    const response = await createTeam(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Unauthorized');
  });

  it('returns 400 when user is already in a team', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockUserFindUnique.mockResolvedValue({ id: 'user-1', teamId: 'existing-team' });

    const request = createRequest('http://localhost:3000/api/teams', {
      body: { name: 'New Team' },
    });
    const response = await createTeam(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Already in a team');
  });

  it('returns 400 when name is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({ tier: 'STUDIO' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-1', teamId: null });

    const request = createRequest('http://localhost:3000/api/teams', {
      body: {},
    });
    const response = await createTeam(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when name exceeds 100 characters', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({ tier: 'STUDIO' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-1', teamId: null });

    const request = createRequest('http://localhost:3000/api/teams', {
      body: { name: 'a'.repeat(101) },
    });
    const response = await createTeam(request);

    expect(response.status).toBe(400);
  });

  it('creates team successfully and adds owner as member', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockSubscriptionFindUnique.mockResolvedValue({ tier: 'STUDIO' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-1', teamId: null });
    mockTeamCreate.mockResolvedValue({
      id: 'team-new',
      name: 'New Team',
      ownerId: 'user-1',
      seats: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const request = createRequest('http://localhost:3000/api/teams', {
      body: { name: 'New Team' },
    });
    const response = await createTeam(request);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty('id', 'team-new');
    expect(body).toHaveProperty('name', 'New Team');
    expect(body).toHaveProperty('ownerId', 'user-1');
  });
});

describe('GET /api/teams/[teamId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/team-1');
    const response = await getTeam(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(401);
  });

  it('returns 404 when team does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/team-1');
    const response = await getTeam(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Team not found');
  });

  it('returns 403 when user is not a member of the team', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-3', email: 'other@example.com' } });
    mockTeamFindUnique.mockResolvedValue(mockTeam);

    const request = createRequest('http://localhost:3000/api/teams/team-1');
    const response = await getTeam(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Not a member');
  });

  it('returns team details when user is a member', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue(mockTeam);

    const request = createRequest('http://localhost:3000/api/teams/team-1');
    const response = await getTeam(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('id', 'team-1');
    expect(body).toHaveProperty('name', 'Engineering Team');
    expect(body.members).toHaveLength(2);
  });
});

describe('PATCH /api/teams/[teamId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/team-1', {
      body: { name: 'Updated Team' },
    });
    const response = await updateTeam(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(401);
  });

  it('returns 404 when team does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/team-1', {
      body: { name: 'Updated Team' },
    });
    const response = await updateTeam(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(404);
  });

  it('returns 403 when user is not the team owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', email: 'member@example.com' } });
    mockTeamFindUnique.mockResolvedValue({ id: 'team-1', ownerId: 'user-1' });

    const request = createRequest('http://localhost:3000/api/teams/team-1', {
      body: { name: 'Updated Team' },
    });
    const response = await updateTeam(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Only the team owner can update the team');
  });

  it('returns 400 when name exceeds 100 characters', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue({ id: 'team-1', ownerId: 'user-1' });

    const request = createRequest('http://localhost:3000/api/teams/team-1', {
      body: { name: 'a'.repeat(101) },
    });
    const response = await updateTeam(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(400);
  });

  it('updates team successfully when user is owner', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue({ id: 'team-1', ownerId: 'user-1' });
    mockTeamUpdate.mockResolvedValue({
      id: 'team-1',
      name: 'Updated Team',
      ownerId: 'user-1',
      seats: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const request = createRequest('http://localhost:3000/api/teams/team-1', {
      body: { name: 'Updated Team' },
    });
    const response = await updateTeam(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('name', 'Updated Team');
  });
});

describe('DELETE /api/teams/[teamId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/team-1');
    const response = await deleteTeam(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(401);
  });

  it('returns 404 when team does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/team-1');
    const response = await deleteTeam(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(404);
  });

  it('returns 403 when user is not the team owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', email: 'member@example.com' } });
    mockTeamFindUnique.mockResolvedValue({ id: 'team-1', ownerId: 'user-1' });

    const request = createRequest('http://localhost:3000/api/teams/team-1');
    const response = await deleteTeam(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Only the team owner can delete the team');
  });

  it('deletes team and removes all members successfully', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue({ id: 'team-1', ownerId: 'user-1' });
    mockUserUpdateMany.mockResolvedValue({ count: 2 });
    mockTeamDelete.mockResolvedValue({ id: 'team-1' });

    const request = createRequest('http://localhost:3000/api/teams/team-1');
    const response = await deleteTeam(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(204);
  });
});

describe('GET /api/teams/[teamId]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/team-1/members');
    const response = await getMembers(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(401);
  });

  it('returns 404 when team does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/team-1/members');
    const response = await getMembers(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(404);
  });

  it('returns 403 when user is not a member', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-3', email: 'other@example.com' } });
    mockTeamFindUnique.mockResolvedValue(mockTeam);

    const request = createRequest('http://localhost:3000/api/teams/team-1/members');
    const response = await getMembers(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(403);
  });

  it('returns members list when user is a member', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue(mockTeam);

    const request = createRequest('http://localhost:3000/api/teams/team-1/members');
    const response = await getMembers(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.members).toHaveLength(2);
    expect(body.members[0]).toHaveProperty('id');
    expect(body.members[0]).toHaveProperty('email');
  });
});

describe('DELETE /api/teams/[teamId]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/team-1/members', {
      body: { userId: 'user-2' },
    });
    const response = await removeMember(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(401);
  });

  it('returns 400 when userId is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);

    const request = createRequest('http://localhost:3000/api/teams/team-1/members', {
      body: {},
    });
    const response = await removeMember(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'userId is required');
  });

  it('returns 404 when team does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/team-1/members', {
      body: { userId: 'user-2' },
    });
    const response = await removeMember(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(404);
  });

  it('returns 400 when trying to remove team owner', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue({ id: 'team-1', ownerId: 'user-1' });

    const request = createRequest('http://localhost:3000/api/teams/team-1/members', {
      body: { userId: 'user-1' },
    });
    const response = await removeMember(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Cannot remove the team owner');
  });

  it('returns 403 when non-owner tries to remove another member', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', email: 'member@example.com' } });
    mockTeamFindUnique.mockResolvedValue({ id: 'team-1', ownerId: 'user-1' });

    const request = createRequest('http://localhost:3000/api/teams/team-1/members', {
      body: { userId: 'user-3' },
    });
    const response = await removeMember(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(403);
  });

  it('allows member to remove themselves', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', email: 'member@example.com' } });
    mockTeamFindUnique.mockResolvedValue({ id: 'team-1', ownerId: 'user-1' });
    mockUserUpdate.mockResolvedValue({ id: 'user-2', teamId: null });

    const request = createRequest('http://localhost:3000/api/teams/team-1/members', {
      body: { userId: 'user-2' },
    });
    const response = await removeMember(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(204);
  });

  it('allows owner to remove any member', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue({ id: 'team-1', ownerId: 'user-1' });
    mockUserUpdate.mockResolvedValue({ id: 'user-2', teamId: null });

    const request = createRequest('http://localhost:3000/api/teams/team-1/members', {
      body: { userId: 'user-2' },
    });
    const response = await removeMember(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(204);
  });
});

describe('GET /api/teams/[teamId]/invite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite');
    const response = await getInvites(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(401);
  });

  it('returns 403 when user is not the team owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', email: 'member@example.com' } });
    mockTeamFindUnique.mockResolvedValue({ id: 'team-1', ownerId: 'user-1' });

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite');
    const response = await getInvites(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(403);
  });

  it('returns invites list for team owner', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue({ id: 'team-1', ownerId: 'user-1' });
    mockTeamInviteFindMany.mockResolvedValue([mockInvite]);

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite');
    const response = await getInvites(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.invites).toHaveLength(1);
  });
});

describe('POST /api/teams/[teamId]/invite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite', {
      body: { email: 'newuser@example.com' },
    });
    const response = await createInvite(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(401);
  });

  it('returns 404 when team does not exist', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite', {
      body: { email: 'newuser@example.com' },
    });
    const response = await createInvite(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(404);
  });

  it('returns 403 when user is not team owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', email: 'member@example.com' } });
    mockTeamFindUnique.mockResolvedValue({
      id: 'team-1',
      ownerId: 'user-1',
      seats: 5,
      _count: { members: 2 },
    });

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite', {
      body: { email: 'newuser@example.com' },
    });
    const response = await createInvite(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Only the team owner can invite members');
  });

  it('returns 400 when team is at capacity', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue({
      id: 'team-1',
      ownerId: 'user-1',
      seats: 5,
      _count: { members: 5 },
    });

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite', {
      body: { email: 'newuser@example.com' },
    });
    const response = await createInvite(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Team is at capacity');
  });

  it('returns 400 when email is invalid', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue({
      id: 'team-1',
      ownerId: 'user-1',
      seats: 5,
      _count: { members: 2 },
    });

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite', {
      body: { email: 'not-an-email' },
    });
    const response = await createInvite(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(400);
  });

  it('returns 400 when user is already a team member', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue({
      id: 'team-1',
      ownerId: 'user-1',
      seats: 5,
      _count: { members: 2 },
    });
    mockUserFindFirst.mockResolvedValue({
      id: 'user-2',
      email: 'member@example.com',
      teamId: 'team-1',
    });

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite', {
      body: { email: 'member@example.com' },
    });
    const response = await createInvite(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'User is already a team member');
  });

  it('returns 400 when pending invite already exists for email', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue({
      id: 'team-1',
      ownerId: 'user-1',
      seats: 5,
      _count: { members: 2 },
    });
    mockUserFindFirst.mockResolvedValue(null);
    mockTeamInviteFindFirst.mockResolvedValue(mockInvite);

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite', {
      body: { email: 'newuser@example.com' },
    });
    const response = await createInvite(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Invite already pending for this email');
  });

  it('creates invite successfully', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue({
      id: 'team-1',
      ownerId: 'user-1',
      seats: 5,
      _count: { members: 2 },
    });
    mockUserFindFirst.mockResolvedValue(null);
    mockTeamInviteFindFirst.mockResolvedValue(null);
    mockTeamInviteCreate.mockResolvedValue(mockInvite);

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite', {
      body: { email: 'newuser@example.com' },
    });
    const response = await createInvite(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty('email', 'newuser@example.com');
    expect(body).toHaveProperty('token');
    expect(body).toHaveProperty('status', 'PENDING');
  });
});

describe('DELETE /api/teams/[teamId]/invite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite', {
      body: { inviteId: 'invite-1' },
    });
    const response = await revokeInvite(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(401);
  });

  it('returns 403 when user is not team owner', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', email: 'member@example.com' } });
    mockTeamFindUnique.mockResolvedValue({ id: 'team-1', ownerId: 'user-1' });

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite', {
      body: { inviteId: 'invite-1' },
    });
    const response = await revokeInvite(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(403);
  });

  it('returns 400 when inviteId is missing', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue({ id: 'team-1', ownerId: 'user-1' });

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite', {
      body: {},
    });
    const response = await revokeInvite(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'inviteId is required');
  });

  it('revokes invite successfully', async () => {
    mockAuth.mockResolvedValue(mockSession);
    mockTeamFindUnique.mockResolvedValue({ id: 'team-1', ownerId: 'user-1' });
    mockTeamInviteUpdate.mockResolvedValue({ ...mockInvite, status: 'REVOKED' });

    const request = createRequest('http://localhost:3000/api/teams/team-1/invite', {
      body: { inviteId: 'invite-1' },
    });
    const response = await revokeInvite(request, createRouteParams({ teamId: 'team-1' }));

    expect(response.status).toBe(204);
  });
});

describe('GET /api/teams/invite/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when invite does not exist', async () => {
    mockTeamInviteFindUnique.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/invite/abc123');
    const response = await getInviteDetails(request, createRouteParams({ token: 'abc123' }));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Invite not found');
  });

  it('returns 400 when invite is not PENDING', async () => {
    mockTeamInviteFindUnique.mockResolvedValue({ ...mockInvite, status: 'ACCEPTED' });

    const request = createRequest('http://localhost:3000/api/teams/invite/abc123');
    const response = await getInviteDetails(request, createRouteParams({ token: 'abc123' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Invite is accepted');
  });

  it('returns 400 and updates status when invite is expired', async () => {
    const expiredInvite = { ...mockInvite, expiresAt: new Date(Date.now() - 1000) };
    mockTeamInviteFindUnique.mockResolvedValue(expiredInvite);
    mockTeamInviteUpdate.mockResolvedValue({ ...expiredInvite, status: 'EXPIRED' });

    const request = createRequest('http://localhost:3000/api/teams/invite/abc123');
    const response = await getInviteDetails(request, createRouteParams({ token: 'abc123' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Invite has expired');
  });

  it('returns invite details when valid', async () => {
    mockTeamInviteFindUnique.mockResolvedValue(mockInvite);

    const request = createRequest('http://localhost:3000/api/teams/invite/abc123');
    const response = await getInviteDetails(request, createRouteParams({ token: 'abc123' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('teamName', 'Engineering Team');
    expect(body).toHaveProperty('email', 'newuser@example.com');
    expect(body).toHaveProperty('expiresAt');
  });
});

describe('POST /api/teams/invite/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/invite/abc123');
    const response = await acceptInvite(request, createRouteParams({ token: 'abc123' }));

    expect(response.status).toBe(401);
  });

  it('returns 404 when invite does not exist', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-new', email: 'newuser@example.com' } });
    mockTeamInviteFindUnique.mockResolvedValue(null);

    const request = createRequest('http://localhost:3000/api/teams/invite/abc123');
    const response = await acceptInvite(request, createRouteParams({ token: 'abc123' }));

    expect(response.status).toBe(404);
  });

  it('returns 400 when invite is not PENDING', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-new', email: 'newuser@example.com' } });
    mockTeamInviteFindUnique.mockResolvedValue({ ...mockInvite, status: 'REVOKED' });

    const request = createRequest('http://localhost:3000/api/teams/invite/abc123');
    const response = await acceptInvite(request, createRouteParams({ token: 'abc123' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Invite is revoked');
  });

  it('returns 400 when invite is expired', async () => {
    const expiredInvite = { ...mockInvite, expiresAt: new Date(Date.now() - 1000) };
    mockAuth.mockResolvedValue({ user: { id: 'user-new', email: 'newuser@example.com' } });
    mockTeamInviteFindUnique.mockResolvedValue(expiredInvite);
    mockTeamInviteUpdate.mockResolvedValue({ ...expiredInvite, status: 'EXPIRED' });

    const request = createRequest('http://localhost:3000/api/teams/invite/abc123');
    const response = await acceptInvite(request, createRouteParams({ token: 'abc123' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Invite has expired');
  });

  it('returns 403 when user email does not match invite', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-new', email: 'wrong@example.com' } });
    mockTeamInviteFindUnique.mockResolvedValue(mockInvite);
    mockUserFindUnique.mockResolvedValue({
      id: 'user-new',
      email: 'wrong@example.com',
      teamId: null,
    });

    const request = createRequest('http://localhost:3000/api/teams/invite/abc123');
    const response = await acceptInvite(request, createRouteParams({ token: 'abc123' }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Email does not match invite');
  });

  it('returns 400 when user is already in a team', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-new', email: 'newuser@example.com' } });
    mockTeamInviteFindUnique.mockResolvedValue(mockInvite);
    mockUserFindUnique.mockResolvedValue({
      id: 'user-new',
      email: 'newuser@example.com',
      teamId: 'other-team',
    });

    const request = createRequest('http://localhost:3000/api/teams/invite/abc123');
    const response = await acceptInvite(request, createRouteParams({ token: 'abc123' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Already in a team');
  });

  it('returns 400 when team is at capacity', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-new', email: 'newuser@example.com' } });
    mockTeamInviteFindUnique.mockResolvedValue({
      ...mockInvite,
      team: { id: 'team-1', seats: 5, _count: { members: 5 } },
    });
    mockUserFindUnique.mockResolvedValue({
      id: 'user-new',
      email: 'newuser@example.com',
      teamId: null,
    });

    const request = createRequest('http://localhost:3000/api/teams/invite/abc123');
    const response = await acceptInvite(request, createRouteParams({ token: 'abc123' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error', 'Team is at capacity');
  });

  it('accepts invite successfully and adds user to team', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-new', email: 'newuser@example.com' } });
    mockTeamInviteFindUnique.mockResolvedValue(mockInvite);
    mockUserFindUnique.mockResolvedValue({
      id: 'user-new',
      email: 'newuser@example.com',
      teamId: null,
    });
    mockTeamInviteUpdate.mockResolvedValue({ ...mockInvite, status: 'ACCEPTED' });
    mockUserUpdate.mockResolvedValue({ id: 'user-new', teamId: 'team-1' });

    const request = createRequest('http://localhost:3000/api/teams/invite/abc123');
    const response = await acceptInvite(request, createRouteParams({ token: 'abc123' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('teamId', 'team-1');
  });
});
