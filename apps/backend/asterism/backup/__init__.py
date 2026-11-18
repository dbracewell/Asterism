"""Backup and restore of one Asterism instance (US-86.4, ADR-0072).

``python -m asterism.backup create`` takes a consistent backup while the app
runs; ``python -m asterism.backup restore`` restores one, offline, into an
empty storage root. See :mod:`asterism.backup.archive` for the archive format.
"""
