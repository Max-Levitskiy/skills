#!/usr/bin/perl
# ml-voice's laptop listener: plays the clips a remote box sends through the
# RemoteForward that this laptop's own SSH connection opens. It listens on
# 127.0.0.1 only, so nothing reaches it but those connections.
#
#   ping                  -> pong (the remote box checks the laptop is there)
#   play <bytes> <ext>    then the bytes -> plays them, then "done"
#
# A connection closed while a clip plays (pause, stop) stops the player.
# Usage: listen.pl [port]   (4714 by default)
use strict;
use warnings;
use IO::Socket::INET;
use IO::Select;
use POSIX ':sys_wait_h';
use File::Temp 'tempfile';

my $port = $ARGV[0] || 4714;
# "done" to a connection a pause already closed must not end the listener.
$SIG{PIPE} = 'IGNORE';
my @player = grep { system("command -v $_->[0] >/dev/null 2>&1") == 0 }
  (['afplay'], ['mpv', '--no-video', '--really-quiet'], ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'error'], ['paplay']);
die "no audio player found (afplay, mpv, ffplay or paplay)\n" unless @player;
my @play = @{ $player[0] };

my $server = IO::Socket::INET->new(LocalAddr => '127.0.0.1', LocalPort => $port, Listen => 5, ReuseAddr => 1)
  or die "cannot listen on 127.0.0.1:$port: $!\n";
print STDERR "ml-voice listener on 127.0.0.1:$port, playing with $play[0]\n";

while (my $client = $server->accept) {
  serve($client);
  close $client;
}

sub serve {
  my ($client) = @_;
  binmode $client;
  my $line = <$client>;
  return unless defined $line;
  if ($line =~ /^ping/) { print $client "pong\n"; return }
  my ($size, $ext) = $line =~ /^play (\d+) (\w+)\s*$/ or return;
  my ($fh, $file) = tempfile(SUFFIX => ".$ext", TMPDIR => 1);
  binmode $fh;
  my $left = $size;
  while ($left > 0) {
    my $got = read($client, my $chunk, $left < 65536 ? $left : 65536);
    last unless $got;
    print $fh $chunk;
    $left -= $got;
  }
  close $fh;
  if ($left == 0) {
    my $pid = fork;
    if (defined $pid && $pid == 0) { open STDOUT, '>', '/dev/null'; exec @play, $file; exit 1 }
    # Nothing more arrives on the connection, so readable means closed.
    my $closed = IO::Select->new($client);
    while (waitpid($pid, WNOHANG) == 0) {
      next unless $closed->can_read(0.2);
      kill 'TERM', $pid;
      waitpid($pid, 0);
      last;
    }
    print $client "done\n";
  }
  unlink $file;
}
